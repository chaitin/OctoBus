package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"octobus/internal/descriptors"
	"octobus/internal/domain"

	_ "modernc.org/sqlite"
)

type Store struct {
	db *sql.DB
}

type ServiceInUseError struct {
	ServiceID  string
	InstanceID string
}

func (e ServiceInUseError) Error() string {
	return fmt.Sprintf("service %q is used by instance %q", e.ServiceID, e.InstanceID)
}

func Open(path string) (*Store, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, err
		}
		if file, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600); err != nil {
			return nil, err
		} else if err := file.Close(); err != nil {
			return nil, err
		}
		if err := os.Chmod(path, 0o600); err != nil {
			return nil, err
		}
	}
	dbPath := path
	if path != ":memory:" {
		dbPath = "file:" + filepath.ToSlash(path)
		q := url.Values{}
		q.Add("_pragma", "busy_timeout(5000)")
		q.Add("_pragma", "journal_mode(WAL)")
		q.Add("_pragma", "foreign_keys(ON)")
		dbPath += "?" + q.Encode()
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	if _, err := db.ExecContext(context.Background(), `PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;`); err != nil {
		_ = db.Close()
		return nil, err
	}
	s := &Store{db: db}
	if err := s.Migrate(context.Background()); err != nil {
		_ = db.Close()
		return nil, err
	}
	if path != ":memory:" {
		if err := secureSQLiteFiles(path); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	return s, nil
}

func secureSQLiteFiles(path string) error {
	for _, candidate := range []string{path, path + "-wal", path + "-shm"} {
		if _, err := os.Stat(candidate); err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return err
		}
		if err := os.Chmod(candidate, 0o600); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) DB() *sql.DB { return s.db }

func (s *Store) Migrate(ctx context.Context) error {
	if _, err := s.db.ExecContext(ctx, schemaSQL); err != nil {
		return err
	}
	if err := addColumnIfMissing(ctx, s.db, "services", "runtime_mode", "TEXT NOT NULL DEFAULT 'long-running'"); err != nil {
		return err
	}
	if err := addColumnIfMissing(ctx, s.db, "services", "secret_schema_path", "TEXT NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumnIfMissing(ctx, s.db, "services", "service_root", "TEXT NOT NULL DEFAULT '.'"); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE services SET runtime_mode = 'long-running' WHERE runtime_mode = ''`)
	return err
}

func addColumnIfMissing(ctx context.Context, db *sql.DB, table, column, definition string) error {
	rows, err := db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var defaultValue any
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return err
		}
		if name == column {
			return nil
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition))
	return err
}

func (s *Store) UpsertService(ctx context.Context, svc domain.Service) error {
	if err := domain.ValidateID("service", svc.ID); err != nil {
		return err
	}
	if svc.RuntimeMode == "" {
		svc.RuntimeMode = domain.RuntimeModeLongRunning
	}
	if svc.ServiceRoot == "" {
		svc.ServiceRoot = "."
	}
	if err := domain.ValidateRuntimeMode(svc.RuntimeMode); err != nil {
		return err
	}
	methodsJSON, err := descriptors.MarshalMethods(svc.Methods)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if svc.CreatedAt.IsZero() {
		svc.CreatedAt = now
	}
	svc.UpdatedAt = now
	_, err = s.db.ExecContext(ctx, `
INSERT INTO services (id, name, package_source, package_artifact_path, package_sha256, package_version, proto_bundle_path, proto_bundle_sha256, descriptor_path, descriptor_sha256, descriptor_version, methods_json, node_entry, service_root, runtime_mode, config_schema_path, secret_schema_path, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  package_source=excluded.package_source,
  package_artifact_path=excluded.package_artifact_path,
  package_sha256=excluded.package_sha256,
  package_version=excluded.package_version,
  proto_bundle_path=excluded.proto_bundle_path,
  proto_bundle_sha256=excluded.proto_bundle_sha256,
  descriptor_path=excluded.descriptor_path,
  descriptor_sha256=excluded.descriptor_sha256,
  descriptor_version=excluded.descriptor_version,
  methods_json=excluded.methods_json,
  node_entry=excluded.node_entry,
  service_root=excluded.service_root,
  runtime_mode=excluded.runtime_mode,
  config_schema_path=excluded.config_schema_path,
  secret_schema_path=excluded.secret_schema_path,
  updated_at=excluded.updated_at`, svc.ID, svc.Name, svc.PackageSource, svc.PackageArtifactPath, svc.PackageSHA256, svc.PackageVersion, svc.ProtoBundlePath, svc.ProtoBundleSHA256, svc.DescriptorPath, svc.DescriptorSHA256, svc.DescriptorVersion, methodsJSON, svc.NodeEntry, svc.ServiceRoot, string(svc.RuntimeMode), svc.ConfigSchemaPath, svc.SecretSchemaPath, formatTime(svc.CreatedAt), formatTime(svc.UpdatedAt))
	return err
}

func (s *Store) GetService(ctx context.Context, id string) (domain.Service, error) {
	row := s.db.QueryRowContext(ctx, serviceSelectSQL+` WHERE id = ?`, id)
	return scanService(row)
}

const serviceSelectSQL = `SELECT id, name, package_source, package_artifact_path, package_sha256, package_version, proto_bundle_path, proto_bundle_sha256, descriptor_path, descriptor_sha256, descriptor_version, methods_json, node_entry, service_root, runtime_mode, config_schema_path, secret_schema_path, created_at, updated_at FROM services`

func scanService(scanner interface {
	Scan(dest ...any) error
}) (domain.Service, error) {
	var svc domain.Service
	var methodsJSON, created, updated string
	var runtimeMode string
	if err := scanner.Scan(&svc.ID, &svc.Name, &svc.PackageSource, &svc.PackageArtifactPath, &svc.PackageSHA256, &svc.PackageVersion, &svc.ProtoBundlePath, &svc.ProtoBundleSHA256, &svc.DescriptorPath, &svc.DescriptorSHA256, &svc.DescriptorVersion, &methodsJSON, &svc.NodeEntry, &svc.ServiceRoot, &runtimeMode, &svc.ConfigSchemaPath, &svc.SecretSchemaPath, &created, &updated); err != nil {
		return domain.Service{}, err
	}
	methods, err := descriptors.UnmarshalMethods(methodsJSON)
	if err != nil {
		return domain.Service{}, err
	}
	svc.Methods = methods
	svc.RuntimeMode = domain.RuntimeMode(runtimeMode)
	if svc.RuntimeMode == "" {
		svc.RuntimeMode = domain.RuntimeModeLongRunning
	}
	if svc.ServiceRoot == "" {
		svc.ServiceRoot = "."
	}
	svc.CreatedAt = parseTime(created)
	svc.UpdatedAt = parseTime(updated)
	return svc, nil
}

func (s *Store) ListServices(ctx context.Context) ([]domain.Service, error) {
	rows, err := s.db.QueryContext(ctx, serviceSelectSQL+` ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Service
	for rows.Next() {
		svc, err := scanService(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, svc)
	}
	return out, rows.Err()
}

func (s *Store) CountServices(ctx context.Context) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM services`).Scan(&count)
	return count, err
}

func (s *Store) UpdateServiceMetadata(ctx context.Context, id, name string) (domain.Service, error) {
	if name == "" {
		return domain.Service{}, errors.New("service name is required")
	}
	if _, err := s.GetService(ctx, id); err != nil {
		return domain.Service{}, err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE services SET name = ?, updated_at = ? WHERE id = ?`, name, formatTime(time.Now().UTC()), id)
	if err != nil {
		return domain.Service{}, err
	}
	return s.GetService(ctx, id)
}

func (s *Store) DeleteService(ctx context.Context, id string) error {
	var instanceID string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM instances WHERE service_id = ? ORDER BY id LIMIT 1`, id).Scan(&instanceID)
	if err == nil {
		return ServiceInUseError{ServiceID: id, InstanceID: instanceID}
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	res, err := s.db.ExecContext(ctx, `DELETE FROM services WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) UpsertInstance(ctx context.Context, inst domain.Instance) error {
	if err := domain.ValidateID("instance", inst.ID); err != nil {
		return err
	}
	if err := domain.ValidateID("service", inst.ServiceID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if inst.CreatedAt.IsZero() {
		inst.CreatedAt = now
	}
	inst.UpdatedAt = now
	if inst.Status == "" {
		inst.Status = domain.StatusStopped
	}
	if inst.ConfigSHA256 == "" {
		inst.ConfigSHA256 = domain.ConfigHash(inst.ConfigJSON)
	}
	if len(inst.SecretJSON) == 0 {
		inst.SecretJSON = json.RawMessage(`{}`)
	}
	if inst.SecretSHA256 == "" {
		inst.SecretSHA256 = domain.HashBytes(inst.SecretJSON)
	}
	var pid any
	if inst.PID != nil {
		pid = *inst.PID
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO instances (id, service_id, name, enabled, status, pid, listen_addr, node_entry, config_json, config_sha256, secret_json, secret_sha256, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  service_id=excluded.service_id,
  name=excluded.name,
  enabled=excluded.enabled,
  status=excluded.status,
  pid=excluded.pid,
  listen_addr=excluded.listen_addr,
  node_entry=excluded.node_entry,
  config_json=excluded.config_json,
  config_sha256=excluded.config_sha256,
  secret_json=excluded.secret_json,
  secret_sha256=excluded.secret_sha256,
  updated_at=excluded.updated_at`, inst.ID, inst.ServiceID, inst.Name, boolInt(inst.Enabled), string(inst.Status), pid, inst.ListenAddr, inst.NodeEntry, string(inst.ConfigJSON), inst.ConfigSHA256, string(inst.SecretJSON), inst.SecretSHA256, formatTime(inst.CreatedAt), formatTime(inst.UpdatedAt))
	return err
}

func (s *Store) GetInstance(ctx context.Context, id string) (domain.Instance, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, service_id, name, enabled, status, pid, listen_addr, node_entry, config_json, config_sha256, secret_json, secret_sha256, created_at, updated_at FROM instances WHERE id = ?`, id)
	return scanInstance(row)
}

func scanInstance(scanner interface {
	Scan(dest ...any) error
}) (domain.Instance, error) {
	var inst domain.Instance
	var enabled int
	var pid sql.NullInt64
	var status, config, secret, created, updated string
	if err := scanner.Scan(&inst.ID, &inst.ServiceID, &inst.Name, &enabled, &status, &pid, &inst.ListenAddr, &inst.NodeEntry, &config, &inst.ConfigSHA256, &secret, &inst.SecretSHA256, &created, &updated); err != nil {
		return domain.Instance{}, err
	}
	inst.Enabled = enabled == 1
	inst.Status = domain.InstanceStatus(status)
	if pid.Valid {
		p := int(pid.Int64)
		inst.PID = &p
	}
	inst.ConfigJSON = json.RawMessage(config)
	inst.SecretJSON = json.RawMessage(secret)
	inst.CreatedAt = parseTime(created)
	inst.UpdatedAt = parseTime(updated)
	return inst, nil
}

func (s *Store) ListInstances(ctx context.Context) ([]domain.Instance, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, service_id, name, enabled, status, pid, listen_addr, node_entry, config_json, config_sha256, secret_json, secret_sha256, created_at, updated_at FROM instances ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Instance
	for rows.Next() {
		inst, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inst)
	}
	return out, rows.Err()
}

func (s *Store) ListEnabledInstancesByService(ctx context.Context, serviceID string) ([]domain.Instance, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, service_id, name, enabled, status, pid, listen_addr, node_entry, config_json, config_sha256, secret_json, secret_sha256, created_at, updated_at FROM instances WHERE service_id = ? AND enabled = 1 ORDER BY id`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Instance
	for rows.Next() {
		inst, err := scanInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, inst)
	}
	return out, rows.Err()
}

func (s *Store) DeleteInstance(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM capset_methods WHERE capset_instance_id IN (SELECT id FROM capset_instances WHERE instance_id = ?)`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM capset_instances WHERE instance_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM instances WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) UpsertCapset(ctx context.Context, cap domain.Capset) error {
	if err := domain.ValidateID("capset", cap.ID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if cap.CreatedAt.IsZero() {
		cap.CreatedAt = now
	}
	cap.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `
INSERT INTO capsets (id, name, description, enabled, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  name=excluded.name,
  description=excluded.description,
  enabled=excluded.enabled,
  updated_at=excluded.updated_at`, cap.ID, cap.Name, cap.Description, boolInt(cap.Enabled), formatTime(cap.CreatedAt), formatTime(cap.UpdatedAt))
	return err
}

func (s *Store) CreateCapset(ctx context.Context, cap domain.Capset) error {
	if err := domain.ValidateID("capset", cap.ID); err != nil {
		return err
	}
	now := time.Now().UTC()
	if cap.CreatedAt.IsZero() {
		cap.CreatedAt = now
	}
	cap.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO capsets (id, name, description, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`, cap.ID, cap.Name, cap.Description, boolInt(cap.Enabled), formatTime(cap.CreatedAt), formatTime(cap.UpdatedAt))
	return err
}

func (s *Store) GetCapset(ctx context.Context, id string) (domain.Capset, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, name, description, enabled, created_at, updated_at FROM capsets WHERE id = ?`, id)
	return scanCapset(row)
}

func scanCapset(scanner interface {
	Scan(dest ...any) error
}) (domain.Capset, error) {
	var cap domain.Capset
	var enabled int
	var created, updated string
	if err := scanner.Scan(&cap.ID, &cap.Name, &cap.Description, &enabled, &created, &updated); err != nil {
		return domain.Capset{}, err
	}
	cap.Enabled = enabled == 1
	cap.CreatedAt = parseTime(created)
	cap.UpdatedAt = parseTime(updated)
	return cap, nil
}

func (s *Store) ListCapsets(ctx context.Context) ([]domain.Capset, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, description, enabled, created_at, updated_at FROM capsets ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Capset
	for rows.Next() {
		cap, err := scanCapset(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, cap)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCapset(ctx context.Context, id string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM capset_tokens WHERE capset_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM capset_methods WHERE capset_instance_id IN (SELECT id FROM capset_instances WHERE capset_id = ?)`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM capset_instances WHERE capset_id = ?`, id); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM capsets WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) AddCapsetToken(ctx context.Context, token domain.CapsetToken, secret string) (domain.CapsetToken, error) {
	if err := domain.ValidateID("capset token", token.ID); err != nil {
		return domain.CapsetToken{}, err
	}
	if secret == "" {
		return domain.CapsetToken{}, errors.New("capset token secret is required")
	}
	if token.Name == "" {
		token.Name = token.ID
	}
	now := time.Now().UTC()
	token.TokenHash = domain.CapsetTokenHash(secret)
	token.CreatedAt = now
	token.LastUsedAt = time.Time{}
	_, err := s.db.ExecContext(ctx, `INSERT INTO capset_tokens (id, capset_id, name, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)`, token.ID, token.CapsetID, token.Name, token.TokenHash, formatTime(token.CreatedAt), formatTime(token.LastUsedAt))
	if err != nil {
		return domain.CapsetToken{}, err
	}
	return s.GetCapsetToken(ctx, token.CapsetID, token.ID)
}

func (s *Store) GetCapsetToken(ctx context.Context, capsetID, id string) (domain.CapsetToken, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, capset_id, name, token_hash, created_at, last_used_at FROM capset_tokens WHERE capset_id = ? AND id = ?`, capsetID, id)
	return scanCapsetToken(row)
}

func scanCapsetToken(scanner interface {
	Scan(dest ...any) error
}) (domain.CapsetToken, error) {
	var token domain.CapsetToken
	var created, lastUsed string
	if err := scanner.Scan(&token.ID, &token.CapsetID, &token.Name, &token.TokenHash, &created, &lastUsed); err != nil {
		return domain.CapsetToken{}, err
	}
	token.CreatedAt = parseTime(created)
	token.LastUsedAt = parseTime(lastUsed)
	return token, nil
}

func (s *Store) ListCapsetTokens(ctx context.Context, capsetID string) ([]domain.CapsetToken, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, capset_id, name, token_hash, created_at, last_used_at FROM capset_tokens WHERE capset_id = ? ORDER BY id`, capsetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.CapsetToken
	for rows.Next() {
		token, err := scanCapsetToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, token)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCapsetToken(ctx context.Context, capsetID, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM capset_tokens WHERE capset_id = ? AND id = ?`, capsetID, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) CapsetRequiresToken(ctx context.Context, capsetID string) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM capset_tokens WHERE capset_id = ?`, capsetID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Store) VerifyCapsetToken(ctx context.Context, capsetID, secret string) (bool, error) {
	if secret == "" {
		return false, nil
	}
	hash := domain.CapsetTokenHash(secret)
	res, err := s.db.ExecContext(ctx, `UPDATE capset_tokens SET last_used_at = ? WHERE capset_id = ? AND token_hash = ?`, formatTime(time.Now().UTC()), capsetID, hash)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *Store) AddAdminToken(ctx context.Context, token domain.AdminToken, secret string) (domain.AdminToken, error) {
	if err := domain.ValidateID("admin token", token.ID); err != nil {
		return domain.AdminToken{}, err
	}
	if secret == "" {
		return domain.AdminToken{}, errors.New("admin token secret is required")
	}
	if token.Name == "" {
		token.Name = token.ID
	}
	now := time.Now().UTC()
	token.TokenHash = domain.AdminTokenHash(secret)
	token.CreatedAt = now
	token.LastUsedAt = time.Time{}
	_, err := s.db.ExecContext(ctx, `INSERT INTO admin_tokens (id, name, token_hash, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)`, token.ID, token.Name, token.TokenHash, formatTime(token.CreatedAt), formatTime(token.LastUsedAt))
	if err != nil {
		return domain.AdminToken{}, err
	}
	return s.GetAdminToken(ctx, token.ID)
}

func (s *Store) GetAdminToken(ctx context.Context, id string) (domain.AdminToken, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, name, token_hash, created_at, last_used_at FROM admin_tokens WHERE id = ?`, id)
	return scanAdminToken(row)
}

func scanAdminToken(scanner interface {
	Scan(dest ...any) error
}) (domain.AdminToken, error) {
	var token domain.AdminToken
	var created, lastUsed string
	if err := scanner.Scan(&token.ID, &token.Name, &token.TokenHash, &created, &lastUsed); err != nil {
		return domain.AdminToken{}, err
	}
	token.CreatedAt = parseTime(created)
	token.LastUsedAt = parseTime(lastUsed)
	return token, nil
}

func (s *Store) ListAdminTokens(ctx context.Context) ([]domain.AdminToken, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, name, token_hash, created_at, last_used_at FROM admin_tokens ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.AdminToken
	for rows.Next() {
		token, err := scanAdminToken(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, token)
	}
	return out, rows.Err()
}

func (s *Store) DeleteAdminToken(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM admin_tokens WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) AdminRequiresToken(ctx context.Context) (bool, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT count(*) FROM admin_tokens`).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Store) VerifyAdminToken(ctx context.Context, secret string) (bool, error) {
	if secret == "" {
		return false, nil
	}
	hash := domain.AdminTokenHash(secret)
	res, err := s.db.ExecContext(ctx, `UPDATE admin_tokens SET last_used_at = ? WHERE token_hash = ?`, formatTime(time.Now().UTC()), hash)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (s *Store) AddCapsetInstance(ctx context.Context, ci domain.CapsetInstance) error {
	if ci.ID == "" {
		ci.ID = fmt.Sprintf("%s:%s", ci.CapsetID, ci.InstanceID)
	}
	now := time.Now().UTC()
	ci.CreatedAt = now
	ci.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO capset_instances (id, capset_id, service_id, instance_id, alias, include_all_methods, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, ci.ID, ci.CapsetID, ci.ServiceID, ci.InstanceID, ci.Alias, boolInt(ci.IncludeAllMethods), boolInt(ci.Enabled), formatTime(ci.CreatedAt), formatTime(ci.UpdatedAt))
	return err
}

func (s *Store) GetCapsetInstance(ctx context.Context, id string) (domain.CapsetInstance, error) {
	row := s.db.QueryRowContext(ctx, `SELECT id, capset_id, service_id, instance_id, alias, include_all_methods, enabled, created_at, updated_at FROM capset_instances WHERE id = ?`, id)
	return scanCapsetInstance(row)
}

func scanCapsetInstance(scanner interface {
	Scan(dest ...any) error
}) (domain.CapsetInstance, error) {
	var ci domain.CapsetInstance
	var includeAll, enabled int
	var created, updated string
	if err := scanner.Scan(&ci.ID, &ci.CapsetID, &ci.ServiceID, &ci.InstanceID, &ci.Alias, &includeAll, &enabled, &created, &updated); err != nil {
		return domain.CapsetInstance{}, err
	}
	ci.IncludeAllMethods = includeAll == 1
	ci.Enabled = enabled == 1
	ci.CreatedAt = parseTime(created)
	ci.UpdatedAt = parseTime(updated)
	return ci, nil
}

func (s *Store) ListCapsetInstances(ctx context.Context, capsetID string) ([]domain.CapsetInstance, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, capset_id, service_id, instance_id, alias, include_all_methods, enabled, created_at, updated_at FROM capset_instances WHERE capset_id = ? ORDER BY service_id, instance_id`, capsetID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.CapsetInstance
	for rows.Next() {
		ci, err := scanCapsetInstance(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ci)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCapsetInstance(ctx context.Context, capsetID, instanceID string) error {
	ciID := fmt.Sprintf("%s:%s", capsetID, instanceID)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM capset_methods WHERE capset_instance_id = ?`, ciID); err != nil {
		return err
	}
	res, err := tx.ExecContext(ctx, `DELETE FROM capset_instances WHERE id = ?`, ciID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return tx.Commit()
}

func (s *Store) AddCapsetMethod(ctx context.Context, method domain.CapsetMethod) error {
	method.MethodFullName = normalizeMethodFullName(method.MethodFullName)
	if method.ID == "" {
		method.ID = fmt.Sprintf("%s:%s", method.CapsetInstanceID, method.MethodFullName)
	}
	now := time.Now().UTC()
	method.CreatedAt = now
	method.UpdatedAt = now
	_, err := s.db.ExecContext(ctx, `INSERT INTO capset_methods (id, capset_instance_id, method_full_name, rest_alias, mcp_tool_name, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, method.ID, method.CapsetInstanceID, method.MethodFullName, method.RestAlias, method.MCPToolName, boolInt(method.Enabled), formatTime(method.CreatedAt), formatTime(method.UpdatedAt))
	return err
}

func (s *Store) GetCapsetMethod(ctx context.Context, capsetInstanceID, methodFullName string) (domain.CapsetMethod, error) {
	methodFullName = normalizeMethodFullName(methodFullName)
	row := s.db.QueryRowContext(ctx, `SELECT id, capset_instance_id, method_full_name, rest_alias, mcp_tool_name, enabled, created_at, updated_at FROM capset_methods WHERE capset_instance_id = ? AND method_full_name = ?`, capsetInstanceID, methodFullName)
	return scanCapsetMethod(row)
}

func scanCapsetMethod(scanner interface {
	Scan(dest ...any) error
}) (domain.CapsetMethod, error) {
	var method domain.CapsetMethod
	var enabled int
	var created, updated string
	if err := scanner.Scan(&method.ID, &method.CapsetInstanceID, &method.MethodFullName, &method.RestAlias, &method.MCPToolName, &enabled, &created, &updated); err != nil {
		return domain.CapsetMethod{}, err
	}
	method.Enabled = enabled == 1
	method.CreatedAt = parseTime(created)
	method.UpdatedAt = parseTime(updated)
	return method, nil
}

func (s *Store) ListCapsetMethods(ctx context.Context, capsetInstanceID string) ([]domain.CapsetMethod, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, capset_instance_id, method_full_name, rest_alias, mcp_tool_name, enabled, created_at, updated_at FROM capset_methods WHERE capset_instance_id = ? ORDER BY method_full_name`, capsetInstanceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.CapsetMethod
	for rows.Next() {
		method, err := scanCapsetMethod(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, method)
	}
	return out, rows.Err()
}

func (s *Store) DeleteCapsetMethod(ctx context.Context, capsetID, instanceID, methodFullName string) error {
	ciID := fmt.Sprintf("%s:%s", capsetID, instanceID)
	res, err := s.db.ExecContext(ctx, `DELETE FROM capset_methods WHERE capset_instance_id = ? AND method_full_name = ?`, ciID, normalizeMethodFullName(methodFullName))
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

type ExposedMethod struct {
	Capset         domain.Capset
	Service        domain.Service
	Instance       domain.Instance
	CapsetInstance domain.CapsetInstance
	CapsetMethod   domain.CapsetMethod
	Method         domain.Method
	DescriptorHash string
	DescriptorPath string
	DescriptorVer  string
	ConnectPath    string
	GRPCMetadata   map[string]string
	MCPToolName    string
}

func ConnectRPCPath(capsetID, instanceID, methodFullName string) string {
	return fmt.Sprintf("/capsets/%s/connect/%s/%s", capsetID, instanceID, methodFullName)
}

func (s *Store) ListExposedMethods(ctx context.Context, capsetID string) ([]ExposedMethod, error) {
	return s.queryExposedMethods(ctx, `c.id = ? AND c.enabled = 1`, []any{capsetID}, `ci.service_id, ci.instance_id, cm.method_full_name`)
}

func (s *Store) queryExposedMethods(ctx context.Context, where string, args []any, orderBy string) ([]ExposedMethod, error) {
	query := `
SELECT c.id, c.name, c.description, c.enabled, c.created_at, c.updated_at,
       ci.id, ci.capset_id, ci.service_id, ci.instance_id, ci.alias, ci.include_all_methods, ci.enabled, ci.created_at, ci.updated_at,
       cm.id, cm.capset_instance_id, cm.method_full_name, cm.rest_alias, cm.mcp_tool_name, cm.enabled, cm.created_at, cm.updated_at,
       i.id, i.service_id, i.name, i.enabled, i.status, i.pid, i.listen_addr, i.node_entry, i.config_json, i.config_sha256, i.created_at, i.updated_at,
       s.id, s.name, s.package_source, s.package_artifact_path, s.package_sha256, s.package_version, s.proto_bundle_path, s.proto_bundle_sha256,
       s.descriptor_path, s.descriptor_sha256, s.descriptor_version, s.methods_json, s.node_entry, s.service_root, s.runtime_mode, s.config_schema_path, s.secret_schema_path, s.created_at, s.updated_at
FROM capsets c
JOIN capset_instances ci ON ci.capset_id = c.id AND ci.enabled = 1
JOIN capset_methods cm ON cm.capset_instance_id = ci.id AND cm.enabled = 1
JOIN instances i ON i.id = ci.instance_id
JOIN services s ON s.id = ci.service_id
WHERE ` + where
	if orderBy != "" {
		query += `
ORDER BY ` + orderBy
	}
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExposedMethod
	serviceCache := map[string]domain.Service{}
	for rows.Next() {
		item, ok, err := scanExposedMethod(rows, serviceCache)
		if err != nil {
			return nil, err
		}
		if !ok {
			continue
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func scanExposedMethod(scanner interface {
	Scan(dest ...any) error
}, serviceCache map[string]domain.Service) (ExposedMethod, bool, error) {
	var item ExposedMethod
	var service domain.Service
	var capEnabled, ciIncludeAll, ciEnabled, cmEnabled, instEnabled int
	var capCreated, capUpdated, ciCreated, ciUpdated, cmCreated, cmUpdated, instCreated, instUpdated string
	var svcMethodsJSON, svcCreated, svcUpdated string
	var svcRuntimeMode string
	var status, config string
	var pid sql.NullInt64
	if err := scanner.Scan(&item.Capset.ID, &item.Capset.Name, &item.Capset.Description, &capEnabled, &capCreated, &capUpdated,
		&item.CapsetInstance.ID, &item.CapsetInstance.CapsetID, &item.CapsetInstance.ServiceID, &item.CapsetInstance.InstanceID, &item.CapsetInstance.Alias, &ciIncludeAll, &ciEnabled, &ciCreated, &ciUpdated,
		&item.CapsetMethod.ID, &item.CapsetMethod.CapsetInstanceID, &item.CapsetMethod.MethodFullName, &item.CapsetMethod.RestAlias, &item.CapsetMethod.MCPToolName, &cmEnabled, &cmCreated, &cmUpdated,
		&item.Instance.ID, &item.Instance.ServiceID, &item.Instance.Name, &instEnabled, &status, &pid, &item.Instance.ListenAddr, &item.Instance.NodeEntry, &config, &item.Instance.ConfigSHA256, &instCreated, &instUpdated,
		&service.ID, &service.Name, &service.PackageSource, &service.PackageArtifactPath, &service.PackageSHA256, &service.PackageVersion, &service.ProtoBundlePath, &service.ProtoBundleSHA256,
		&service.DescriptorPath, &service.DescriptorSHA256, &service.DescriptorVersion, &svcMethodsJSON, &service.NodeEntry, &service.ServiceRoot, &svcRuntimeMode, &service.ConfigSchemaPath, &service.SecretSchemaPath, &svcCreated, &svcUpdated); err != nil {
		return ExposedMethod{}, false, err
	}
	if cached, ok := serviceCache[service.ID]; ok {
		service = cached
	} else {
		methods, err := descriptors.UnmarshalMethods(svcMethodsJSON)
		if err != nil {
			return ExposedMethod{}, false, err
		}
		service.Methods = methods
		service.RuntimeMode = domain.RuntimeMode(svcRuntimeMode)
		if service.RuntimeMode == "" {
			service.RuntimeMode = domain.RuntimeModeLongRunning
		}
		service.CreatedAt = parseTime(svcCreated)
		service.UpdatedAt = parseTime(svcUpdated)
		serviceCache[service.ID] = service
	}
	item.Capset.Enabled = capEnabled == 1
	item.Capset.CreatedAt = parseTime(capCreated)
	item.Capset.UpdatedAt = parseTime(capUpdated)
	item.CapsetInstance.IncludeAllMethods = ciIncludeAll == 1
	item.CapsetInstance.Enabled = ciEnabled == 1
	item.CapsetInstance.CreatedAt = parseTime(ciCreated)
	item.CapsetInstance.UpdatedAt = parseTime(ciUpdated)
	item.CapsetMethod.Enabled = cmEnabled == 1
	item.CapsetMethod.CreatedAt = parseTime(cmCreated)
	item.CapsetMethod.UpdatedAt = parseTime(cmUpdated)
	item.Instance.Enabled = instEnabled == 1
	item.Instance.Status = domain.InstanceStatus(status)
	if pid.Valid {
		p := int(pid.Int64)
		item.Instance.PID = &p
	}
	item.Instance.ConfigJSON = json.RawMessage(config)
	item.Instance.CreatedAt = parseTime(instCreated)
	item.Instance.UpdatedAt = parseTime(instUpdated)
	item.Service = service
	method, ok := findMethod(service.Methods, item.CapsetMethod.MethodFullName)
	if !ok {
		return ExposedMethod{}, false, nil
	}
	item.Method = method
	item.DescriptorHash = service.DescriptorSHA256
	item.DescriptorPath = service.DescriptorPath
	item.DescriptorVer = service.DescriptorVersion
	item.ConnectPath = ConnectRPCPath(item.Capset.ID, item.Instance.ID, method.FullName)
	item.GRPCMetadata = map[string]string{"x-octobus-capset": item.Capset.ID, "x-octobus-instance": item.Instance.ID}
	item.MCPToolName = item.CapsetMethod.MCPToolName
	if item.MCPToolName == "" {
		item.MCPToolName = domain.MCPToolName(service.ID, item.Instance.ID, method.FullName)
	}
	return item, true, nil
}

func (s *Store) FindExposedMethod(ctx context.Context, capsetID, serviceID, instanceID, methodFullName string) (ExposedMethod, error) {
	items, err := s.queryExposedMethods(ctx, `c.id = ? AND c.enabled = 1 AND ci.service_id = ? AND ci.instance_id = ? AND cm.method_full_name = ?`, []any{capsetID, serviceID, instanceID, normalizeMethodFullName(methodFullName)}, ``)
	if err != nil {
		return ExposedMethod{}, err
	}
	if len(items) == 0 {
		return ExposedMethod{}, sql.ErrNoRows
	}
	return items[0], nil
}

func (s *Store) FindExposedMethodByInstance(ctx context.Context, capsetID, instanceID, methodFullName string) (ExposedMethod, error) {
	items, err := s.queryExposedMethods(ctx, `c.id = ? AND c.enabled = 1 AND ci.instance_id = ? AND cm.method_full_name = ?`, []any{capsetID, instanceID, normalizeMethodFullName(methodFullName)}, ``)
	if err != nil {
		return ExposedMethod{}, err
	}
	if len(items) == 0 {
		method, err := s.findKnownCapsetMethodByInstance(ctx, capsetID, instanceID, methodFullName)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return ExposedMethod{}, err
		}
		if err == nil && !method.Unary {
			return ExposedMethod{}, domain.ErrMethodNotUnary
		}
		return ExposedMethod{}, sql.ErrNoRows
	}
	return items[0], nil
}

func (s *Store) FindTool(ctx context.Context, capsetID, toolName string) (ExposedMethod, error) {
	items, err := s.queryExposedMethods(ctx, `c.id = ? AND c.enabled = 1 AND cm.mcp_tool_name = ?`, []any{capsetID, toolName}, ``)
	if err != nil {
		return ExposedMethod{}, err
	}
	defaultItems, err := s.queryExposedMethods(ctx, `c.id = ? AND c.enabled = 1 AND cm.mcp_tool_name = '' AND substr(?, 1, length(ci.service_id) + length(ci.instance_id) + 4) = ci.service_id || '__' || ci.instance_id || '__'`, []any{capsetID, toolName}, ``)
	if err != nil {
		return ExposedMethod{}, err
	}
	items = append(items, defaultItems...)
	item, err := findToolByName(items, toolName)
	if err == nil {
		if !item.Method.Unary {
			return ExposedMethod{}, domain.ErrMethodNotUnary
		}
		return item, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return ExposedMethod{}, err
	}
	if streamingErr := s.findKnownStreamingTool(ctx, capsetID, toolName); streamingErr != nil {
		if errors.Is(streamingErr, domain.ErrMethodNotUnary) {
			return ExposedMethod{}, domain.ErrMethodNotUnary
		}
		if !errors.Is(streamingErr, sql.ErrNoRows) {
			return ExposedMethod{}, streamingErr
		}
	}
	return ExposedMethod{}, sql.ErrNoRows
}

func (s *Store) findKnownCapsetMethod(ctx context.Context, capsetID, serviceID, instanceID, methodFullName string) (domain.Method, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT s.methods_json
FROM capsets c
JOIN capset_instances ci ON ci.capset_id = c.id AND ci.enabled = 1
JOIN instances i ON i.id = ci.instance_id
JOIN services s ON s.id = ci.service_id
WHERE c.id = ? AND c.enabled = 1 AND ci.service_id = ? AND ci.instance_id = ?`, capsetID, serviceID, instanceID)
	var methodsJSON string
	if err := row.Scan(&methodsJSON); err != nil {
		return domain.Method{}, err
	}
	methods, err := descriptors.UnmarshalMethods(methodsJSON)
	if err != nil {
		return domain.Method{}, err
	}
	method, ok := findMethod(methods, methodFullName)
	if !ok {
		return domain.Method{}, sql.ErrNoRows
	}
	return method, nil
}

func (s *Store) findKnownCapsetMethodByInstance(ctx context.Context, capsetID, instanceID, methodFullName string) (domain.Method, error) {
	row := s.db.QueryRowContext(ctx, `
SELECT s.methods_json
FROM capsets c
JOIN capset_instances ci ON ci.capset_id = c.id AND ci.enabled = 1
JOIN instances i ON i.id = ci.instance_id
JOIN services s ON s.id = ci.service_id
WHERE c.id = ? AND c.enabled = 1 AND ci.instance_id = ?`, capsetID, instanceID)
	var methodsJSON string
	if err := row.Scan(&methodsJSON); err != nil {
		return domain.Method{}, err
	}
	methods, err := descriptors.UnmarshalMethods(methodsJSON)
	if err != nil {
		return domain.Method{}, err
	}
	method, ok := findMethod(methods, methodFullName)
	if !ok {
		return domain.Method{}, sql.ErrNoRows
	}
	return method, nil
}

func (s *Store) findKnownStreamingTool(ctx context.Context, capsetID, toolName string) error {
	rows, err := s.db.QueryContext(ctx, `
SELECT ci.service_id, ci.instance_id, ci.include_all_methods, cm.mcp_tool_name, cm.method_full_name, s.methods_json
FROM capsets c
JOIN capset_instances ci ON ci.capset_id = c.id AND ci.enabled = 1
JOIN services s ON s.id = ci.service_id
LEFT JOIN capset_methods cm ON cm.capset_instance_id = ci.id AND cm.enabled = 1
WHERE c.id = ? AND c.enabled = 1`, capsetID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var serviceID, instanceID, methodsJSON string
		var includeAll int
		var customTool, selectedMethod sql.NullString
		if err := rows.Scan(&serviceID, &instanceID, &includeAll, &customTool, &selectedMethod, &methodsJSON); err != nil {
			return err
		}
		methods, err := descriptors.UnmarshalMethods(methodsJSON)
		if err != nil {
			return err
		}
		for _, method := range methods {
			if method.Unary {
				continue
			}
			if selectedMethod.Valid && normalizeMethodFullName(selectedMethod.String) == method.FullName {
				name := customTool.String
				if name == "" {
					name = domain.MCPToolName(serviceID, instanceID, method.FullName)
				}
				if name == toolName {
					return domain.ErrMethodNotUnary
				}
			}
			if includeAll == 1 && domain.MCPToolName(serviceID, instanceID, method.FullName) == toolName {
				return domain.ErrMethodNotUnary
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return sql.ErrNoRows
}

func findToolByName(items []ExposedMethod, toolName string) (ExposedMethod, error) {
	var found *ExposedMethod
	for _, item := range items {
		if item.MCPToolName == toolName {
			if found != nil {
				return ExposedMethod{}, errors.New("ambiguous MCP tool name")
			}
			copy := item
			found = &copy
		}
	}
	if found != nil {
		return *found, nil
	}
	return ExposedMethod{}, sql.ErrNoRows
}

func (s *Store) MCPToolNameExists(ctx context.Context, capsetID, toolName string) (bool, error) {
	_, err := s.FindTool(ctx, capsetID, toolName)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

func findMethod(methods []domain.Method, fullName string) (domain.Method, bool) {
	fullName = normalizeMethodFullName(fullName)
	for _, method := range methods {
		if method.FullName == fullName || "/"+method.FullName == fullName {
			return method, true
		}
	}
	return domain.Method{}, false
}

func normalizeMethodFullName(method string) string {
	return strings.TrimPrefix(method, "/")
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func formatTime(t time.Time) string {
	return t.UTC().Format(time.RFC3339Nano)
}

func parseTime(s string) time.Time {
	t, _ := time.Parse(time.RFC3339Nano, s)
	return t
}

const schemaSQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  package_source TEXT NOT NULL,
  package_artifact_path TEXT NOT NULL,
  package_sha256 TEXT NOT NULL,
  package_version TEXT NOT NULL DEFAULT '',
  proto_bundle_path TEXT NOT NULL DEFAULT '',
  proto_bundle_sha256 TEXT NOT NULL DEFAULT '',
  descriptor_path TEXT NOT NULL,
  descriptor_sha256 TEXT NOT NULL,
  descriptor_version TEXT NOT NULL,
  methods_json TEXT NOT NULL,
  node_entry TEXT NOT NULL DEFAULT '',
  service_root TEXT NOT NULL DEFAULT '.',
  runtime_mode TEXT NOT NULL DEFAULT 'long-running',
  config_schema_path TEXT NOT NULL DEFAULT '',
  secret_schema_path TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  pid INTEGER,
  listen_addr TEXT,
  node_entry TEXT NOT NULL,
  config_json TEXT NOT NULL,
  config_sha256 TEXT NOT NULL DEFAULT '',
  secret_json TEXT NOT NULL DEFAULT '{}',
  secret_sha256 TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS capsets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS capset_instances (
  id TEXT PRIMARY KEY,
  capset_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  alias TEXT NOT NULL DEFAULT '',
  include_all_methods INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(capset_id) REFERENCES capsets(id),
  FOREIGN KEY(service_id) REFERENCES services(id),
  FOREIGN KEY(instance_id) REFERENCES instances(id)
);

CREATE TABLE IF NOT EXISTS capset_methods (
  id TEXT PRIMARY KEY,
  capset_instance_id TEXT NOT NULL,
  method_full_name TEXT NOT NULL,
  rest_alias TEXT NOT NULL DEFAULT '',
  mcp_tool_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(capset_instance_id) REFERENCES capset_instances(id)
);

CREATE TABLE IF NOT EXISTS capset_tokens (
  id TEXT NOT NULL,
  capset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(capset_id, id),
  FOREIGN KEY(capset_id) REFERENCES capsets(id)
);

CREATE TABLE IF NOT EXISTS admin_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_instances_service_enabled ON instances(service_id, enabled);
CREATE INDEX IF NOT EXISTS idx_capset_instances_capset ON capset_instances(capset_id);
CREATE INDEX IF NOT EXISTS idx_capset_instances_instance ON capset_instances(instance_id);
CREATE INDEX IF NOT EXISTS idx_capset_instances_service_instance ON capset_instances(service_id, instance_id);
CREATE INDEX IF NOT EXISTS idx_capset_methods_instance_method ON capset_methods(capset_instance_id, method_full_name);
CREATE INDEX IF NOT EXISTS idx_capset_methods_mcp_tool ON capset_methods(mcp_tool_name);
CREATE INDEX IF NOT EXISTS idx_capset_tokens_hash ON capset_tokens(capset_id, token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_tokens_hash ON admin_tokens(token_hash);
`
