package store

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	encryptedSecretPrefix = "octobus-secret-v1:"
	secretKeyEnv          = "OCTOBUS_SECRET_ENCRYPTION_KEY"
	secretKeyFileEnv      = "OCTOBUS_SECRET_ENCRYPTION_KEY_FILE"
	secretKeyBytes        = 32
)

func loadSecretKey(dbPath string, hasEncryptedSecrets func() (bool, error)) ([]byte, error) {
	if encoded := os.Getenv(secretKeyEnv); encoded != "" {
		key, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(key) != secretKeyBytes {
			return nil, fmt.Errorf("%s must be base64-encoded %d-byte key", secretKeyEnv, secretKeyBytes)
		}
		return key, nil
	}
	if dbPath == ":memory:" {
		return randomSecretKey()
	}

	keyPath := os.Getenv(secretKeyFileEnv)
	if keyPath == "" {
		keyPath = dbPath + ".secret-key"
	}
	key, err := readSecretKeyFile(keyPath)
	if err == nil {
		return key, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if hasEncryptedSecrets != nil {
		encrypted, checkErr := hasEncryptedSecrets()
		if checkErr != nil {
			return nil, checkErr
		}
		if encrypted {
			return nil, fmt.Errorf("secret key file %q is missing while encrypted instance secrets exist", keyPath)
		}
	}
	key, err = randomSecretKey()
	if err != nil {
		return nil, err
	}
	if err := writeSecretKeyAtomically(keyPath, key); err == nil {
		return key, nil
	} else if !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	for attempt := 0; attempt < 5; attempt++ {
		key, err = readSecretKeyFile(keyPath)
		if err == nil {
			return key, nil
		}
		if !errors.Is(err, errInvalidSecretKeyLength) {
			return nil, err
		}
		time.Sleep(10 * time.Millisecond)
	}
	return nil, fmt.Errorf("read secret key file %q: %w", keyPath, errInvalidSecretKeyLength)
}

var errInvalidSecretKeyLength = errors.New("secret key has invalid length")

func readSecretKeyFile(path string) ([]byte, error) {
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(key) != secretKeyBytes {
		return nil, fmt.Errorf("%w: %q", errInvalidSecretKeyLength, path)
	}
	if err := os.Chmod(path, 0o600); err != nil {
		return nil, err
	}
	return key, nil
}

func writeSecretKeyAtomically(path string, key []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".secret-key-")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return err
	}
	if _, err := tmp.Write(key); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Link(tmpPath, path); err != nil {
		return err
	}
	return nil
}

func (s *Store) validateSecretKey(ctx context.Context) error {
	var encoded string
	err := s.db.QueryRowContext(ctx, `SELECT secret_json FROM instances WHERE substr(secret_json, 1, ?) = ? LIMIT 1`, len(encryptedSecretPrefix), encryptedSecretPrefix).Scan(&encoded)
	if errors.Is(err, sql.ErrNoRows) || strings.Contains(errString(err), "no such table") {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := decryptSecret(s.secretKey, encoded); err != nil {
		return fmt.Errorf("secret encryption key does not decrypt stored instance secrets: %w", err)
	}
	return nil
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func randomSecretKey() ([]byte, error) {
	key := make([]byte, secretKeyBytes)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, err
	}
	return key, nil
}

func encryptSecret(key, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	ciphertext := gcm.Seal(nonce, nonce, plaintext, nil)
	return encryptedSecretPrefix + base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptSecret(key []byte, encoded string) ([]byte, error) {
	if len(encoded) < len(encryptedSecretPrefix) || encoded[:len(encryptedSecretPrefix)] != encryptedSecretPrefix {
		return []byte(encoded), nil
	}
	payload, err := base64.RawStdEncoding.DecodeString(encoded[len(encryptedSecretPrefix):])
	if err != nil {
		return nil, fmt.Errorf("decode encrypted instance secret: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(payload) < gcm.NonceSize() {
		return nil, errors.New("encrypted instance secret is truncated")
	}
	return gcm.Open(nil, payload[:gcm.NonceSize()], payload[gcm.NonceSize():], nil)
}

func (s *Store) encryptLegacySecrets(ctx context.Context) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id, secret_json FROM instances WHERE secret_json <> '' AND substr(secret_json, 1, ?) <> ?`, len(encryptedSecretPrefix), encryptedSecretPrefix)
	if err != nil {
		return err
	}
	type legacySecret struct {
		id   string
		data string
	}
	var legacy []legacySecret
	for rows.Next() {
		var item legacySecret
		if err := rows.Scan(&item.id, &item.data); err != nil {
			_ = rows.Close()
			return err
		}
		legacy = append(legacy, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(legacy) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range legacy {
		encrypted, err := encryptSecret(s.secretKey, []byte(item.data))
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE instances SET secret_json = ? WHERE id = ?`, encrypted, item.id); err != nil {
			return err
		}
	}
	return tx.Commit()
}
