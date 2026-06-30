package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type clientConfig struct {
	BaseURL  string
	Capset   string
	Instance string
	Token    string
}

var cfg = clientConfig{
	BaseURL:  "http://127.0.0.1:9000",
	Capset:   "mbs-scenarios",
	Instance: "mbs-test",
	Token:    "",
}

const (
	uid1 = "1691979294102310912" // test1
	uid2 = "1691979421122613248" // test2
)

var pass, failn int

func gf(m map[string]any, k string) float64 {
	f, _ := m[k].(float64)
	return f
}

func gs(m map[string]any, k string) string {
	s, _ := m[k].(string)
	return s
}

func gm(m map[string]any, k string) map[string]any {
	v, _ := m[k].(map[string]any)
	return v
}

func ok(s string, a ...any) {
	pass++
	fmt.Printf("   PASS | "+s+"\n", a...)
}

func fl(s string, a ...any) {
	failn++
	fmt.Printf("   FAIL | "+s+"\n", a...)
}

func inf(s string, a ...any) {
	fmt.Printf("   INFO | "+s+"\n", a...)
}

func scene(note string) {
	fmt.Printf("   SCENE | %s\n", note)
}

func hdr(s string) {
	fmt.Printf("\n== %s ==\n", s)
}

func methodURL(method string) string {
	base := strings.TrimRight(cfg.BaseURL, "/")
	return fmt.Sprintf("%s/capsets/%s/connect/%s/zhizhangyi.mbs.UserManagement/%s", base, cfg.Capset, cfg.Instance, method)
}

func call(method string, body map[string]any) (map[string]any, int, error) {
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequest(http.MethodPost, methodURL(method), bytes.NewReader(buf))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if cfg.Token != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Token)
	}
	cli := &http.Client{Timeout: 30 * time.Second}
	resp, err := cli.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, err
	}
	var out map[string]any
	if len(raw) == 0 {
		out = map[string]any{}
	} else if err := json.Unmarshal(raw, &out); err != nil {
		return map[string]any{"raw": string(raw)}, resp.StatusCode, fmt.Errorf("decode response: %w", err)
	}
	if resp.StatusCode >= 300 {
		return out, resp.StatusCode, fmt.Errorf("http=%d", resp.StatusCode)
	}
	if code, ok := out["code"].(string); ok && code != "" {
		return out, resp.StatusCode, fmt.Errorf("connect_code=%s message=%s", code, gs(out, "message"))
	}
	return out, resp.StatusCode, nil
}

func detail(uid string) (map[string]any, error) {
	r, _, err := call("DetailUser", map[string]any{"userId": uid})
	return r, err
}

func userDetail(uid string) (map[string]any, error) {
	r, err := detail(uid)
	if err != nil {
		return nil, err
	}
	return gm(r, "data"), nil
}

func scenario1() {
	hdr("场景1: 停用 test2，不自动恢复")
	scene("场景备注：模拟管理员手动停用 test2，执行后保留停用状态，方便去 MBS 前端观察启停变化")
	_, _, err := call("StateUsers", map[string]any{"userIds": []string{uid2}, "type": 0, "state": "0"})
	if err != nil {
		fl("StateUsers failed: %v", err)
		return
	}
	ok("StateUsers returned success")
	d, err := userDetail(uid2)
	if err != nil {
		fl("DetailUser verify failed: %v", err)
		return
	}
	if gf(d, "state") == 0 {
		ok("test2.state=0")
	} else {
		fl("test2.state=%.0f", gf(d, "state"))
	}
	inf("已停用 test2，当前脚本不会自动恢复，便于前端观察状态变化")
}

func scenario2() {
	hdr("场景2: 停用 test1，不自动恢复")
	scene("场景备注：模拟管理员手动停用 test1，执行后保留停用状态，方便去 MBS 前端观察启停变化")
	_, _, err := call("StateUsers", map[string]any{"userIds": []string{uid1}, "type": 0, "state": "0"})
	if err != nil {
		fl("StateUsers failed: %v", err)
		return
	}
	ok("StateUsers returned success")
	d, err := userDetail(uid1)
	if err != nil {
		fl("DetailUser verify failed: %v", err)
		return
	}
	if gf(d, "state") == 0 {
		ok("test1.state=0")
	} else {
		fl("test1.state=%.0f", gf(d, "state"))
	}
	inf("已停用 test1，当前脚本不会自动恢复，便于前端观察状态变化")
}

func scenario3() {
	hdr("场景3: 开启 test1 设备管控")
	scene("场景备注：模拟管理员给 test1 开启设备管控，用于前端观察 isMdm 或设备管理状态变化")
	_, _, err := call("UpdUser", map[string]any{
		"userId":    uid1,
		"userName":  "测试1",
		"loginName": "test1",
		"deptId":    "1",
		"isMdm":     1,
	})
	if err != nil {
		fl("UpdUser failed: %v", err)
		return
	}
	ok("UpdUser returned success")
	d, err := userDetail(uid1)
	if err != nil {
		fl("DetailUser verify failed: %v", err)
		return
	}
	if gf(d, "isMdm") == 1 {
		ok("test1.isMdm=1")
	} else {
		fl("test1.isMdm=%.0f", gf(d, "isMdm"))
	}
	inf("test1.state=%.0f", gf(d, "state"))
}

func tGetUsers() {
	hdr("6.2.1 GetUsers")
	scene("场景备注：查询用户列表，适合先确认 OctoBus 到 MBS 的读取链路已经打通")
	r, _, err := call("GetUsers", map[string]any{
		"index": 0,
		"size":  10,
		"condition": map[string]any{
			"deptId":  "1",
			"keyWord": "",
		},
	})
	if err != nil {
		fl("GetUsers failed: %v", err)
		return
	}
	d := gm(r, "data")
	inf("total=%.0f", gf(d, "total"))
	if gf(d, "total") >= 2 {
		ok("total>=2")
	} else {
		fl("total=%.0f", gf(d, "total"))
	}
}

func tAddUser() {
	hdr("6.2.2 AddUser")
	scene("场景备注：新增一个测试用户，适合验证创建类接口；执行前建议先确认账号命名规则和回收策略")
	payload := map[string]any{
		"userName":       "OctoBus新增用户",
		"loginName":      fmt.Sprintf("octobus_add_%d", time.Now().Unix()),
		"deptId":         "1",
		"password":       "123456",
		"phoneNumber":    "13800138111",
		"userSource":     0,
		"isMdm":          0,
		"state":          1,
		"organization":   "OctoBus",
		"employeeNumber": fmt.Sprintf("E%d", time.Now().Unix()%100000),
	}
	r, _, err := call("AddUser", payload)
	if err != nil {
		fl("AddUser failed: %v", err)
		inf("payload=%s", mustJSON(payload))
		return
	}
	ok("AddUser returned success")
	inf("response=%s", mustJSON(r))
}

func tUpdUser() {
	hdr("6.2.3 UpdUser")
	scene("场景备注：修改 test1 的基础字段，适合验证用户编辑能力是否可通过 OctoBus 正常下发")
	_, _, err := call("UpdUser", map[string]any{
		"userId":    uid1,
		"userName":  "测试1",
		"loginName": "test1",
		"deptId":    "1",
		"weight":    1,
	})
	if err != nil {
		fl("UpdUser failed: %v", err)
		return
	}
	ok("UpdUser returned success")
}

func tDetailUser() {
	hdr("6.2.4 DetailUser")
	scene("场景备注：查看 test1 当前详情，适合在做写操作前先确认用户当前状态")
	r, _, err := call("DetailUser", map[string]any{"userId": uid1})
	if err != nil {
		fl("DetailUser failed: %v", err)
		return
	}
	d := gm(r, "data")
	inf("loginName=%s state=%.0f isMdm=%.0f", gs(d, "loginName"), gf(d, "state"), gf(d, "isMdm"))
	if gs(d, "loginName") == "test1" {
		ok("loginName=test1")
	} else {
		fl("loginName=%s", gs(d, "loginName"))
	}
}

func tDelUsers() {
	hdr("6.2.5 DelUsers")
	scene("场景备注：删除指定测试用户，适合验证删除链路；执行前必须先把目标 userId 换成你自己的测试账号")
	payload := map[string]any{"userIds": []string{"replace-with-user-id"}, "type": 0}
	r, _, err := call("DelUsers", payload)
	if err != nil {
		fl("DelUsers failed: %v", err)
		inf("payload=%s", mustJSON(payload))
		return
	}
	ok("DelUsers returned success")
	inf("response=%s", mustJSON(r))
}

func tStateUsers() {
	hdr("6.2.6 StateUsers")
	scene("场景备注：演示用户启停接口，这里默认把 test2 设为启用，可作为停用后的恢复动作")
	_, _, err := call("StateUsers", map[string]any{"userIds": []string{uid2}, "type": 0, "state": "1"})
	if err != nil {
		fl("StateUsers failed: %v", err)
		return
	}
	ok("StateUsers returned success")
}

func tCheckLoginName() {
	hdr("6.2.7 CheckLoginName")
	scene("场景备注：同时验证一个已存在账号和一个新账号，适合检查业务错误映射和可用性判断")
	r1, _, err1 := call("CheckLoginName", map[string]any{"loginName": "test1"})
	if err1 != nil {
		inf("test1 occupied, resp=%s err=%v", mustJSON(r1), err1)
		ok("existing login name returned business error as expected")
	} else {
		fl("test1 unexpectedly passed, resp=%s", mustJSON(r1))
	}
	r2, _, err2 := call("CheckLoginName", map[string]any{"loginName": fmt.Sprintf("octobus_free_%d", time.Now().Unix())})
	if err2 != nil {
		fl("new login name failed: %v", err2)
		return
	}
	ok("new login name returned success")
	inf("response=%s", mustJSON(r2))
}

func tGetUserByPhone() {
	hdr("6.2.8 GetUserByPhone")
	scene("场景备注：按手机号查询用户，适合验证手机号索引查询能力是否正常")
	r, _, err := call("GetUserByPhone", map[string]any{"phone": "13800138000"})
	if err != nil {
		fl("GetUserByPhone failed: %v", err)
		return
	}
	ok("GetUserByPhone returned success")
	inf("response=%s", mustJSON(r))
}

func tUpdUserPwd() {
	hdr("6.2.9/6.2.10 UpdUserPwd")
	scene("场景备注：修改用户密码，适合验证敏感写操作；执行前要先准备好 3DES 加密后的密码串")
	payload := map[string]any{
		"userId":   uid1,
		"password": "replace-with-3des-password",
		"version":  "v1",
	}
	r, _, err := call("UpdUserPwd", payload)
	if err != nil {
		fl("UpdUserPwd failed: %v", err)
		inf("payload=%s", mustJSON(payload))
		return
	}
	ok("UpdUserPwd returned success")
	inf("response=%s", mustJSON(r))
}

func tForceOffline() {
	hdr("6.2.11 ForceOffline")
	scene("场景备注：强制指定用户下线，适合验证在线会话踢出能力；前提是目标用户当前在线")
	r, _, err := call("ForceOffline", map[string]any{"userId": uid1})
	if err != nil {
		fl("ForceOffline failed: %v", err)
		return
	}
	ok("ForceOffline returned success")
	inf("response=%s", mustJSON(r))
}

func tImportUser() {
	hdr("6.2.12 ImportUser")
	scene("场景备注：通过 fileId 导入用户，适合验证批量导入能力；前提是你已经先完成文件上传")
	payload := map[string]any{"lang": 2, "fileId": "replace-with-uploaded-file-id"}
	r, _, err := call("ImportUser", payload)
	if err != nil {
		fl("ImportUser failed: %v", err)
		inf("payload=%s", mustJSON(payload))
		return
	}
	ok("ImportUser returned success")
	inf("response=%s", mustJSON(r))
}

func mustJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return fmt.Sprintf("marshal-error:%v", err)
	}
	return string(b)
}

func main() {
	baseURL := flag.String("base-url", cfg.BaseURL, "OctoBus base URL")
	capset := flag.String("capset", cfg.Capset, "OctoBus capset ID")
	instance := flag.String("instance", cfg.Instance, "OctoBus instance ID")
	token := flag.String("token", cfg.Token, "OctoBus bearer token")
	tn := flag.String("test", "all", "test name: all|scenarios|apis|scenario1|getUsers|...")
	flag.Parse()

	cfg.BaseURL = *baseURL
	cfg.Capset = *capset
	cfg.Instance = *instance
	cfg.Token = *token

	all := map[string]func(){
		"scenario1":      scenario1,
		"scenario2":      scenario2,
		"scenario3":      scenario3,
		"getUsers":       tGetUsers,
		"addUser":        tAddUser,
		"updUser":        tUpdUser,
		"detailUser":     tDetailUser,
		"delUsers":       tDelUsers,
		"stateUsers":     tStateUsers,
		"checkLoginName": tCheckLoginName,
		"getUserByPhone": tGetUserByPhone,
		"updUserPwd":     tUpdUserPwd,
		"forceOffline":   tForceOffline,
		"importUser":     tImportUser,
	}

	run := func(keys []string) {
		for _, k := range keys {
			all[k]()
		}
	}

	switch *tn {
	case "scenarios":
		run([]string{"scenario1", "scenario2", "scenario3"})
	case "apis":
		run([]string{"getUsers", "addUser", "updUser", "detailUser", "delUsers", "stateUsers", "checkLoginName", "getUserByPhone", "updUserPwd", "forceOffline", "importUser"})
	case "all":
		run([]string{"scenario1", "scenario2", "scenario3", "getUsers", "addUser", "updUser", "detailUser", "delUsers", "stateUsers", "checkLoginName", "getUserByPhone", "updUserPwd", "forceOffline", "importUser"})
	default:
		fn, ok := all[*tn]
		if !ok {
			fmt.Fprintf(os.Stderr, "unknown test: %s\n", *tn)
			os.Exit(1)
		}
		fn()
	}

	fmt.Printf("\n===================================\n")
	fmt.Printf("Results: %d passed, %d failed\n", pass, failn)
	if failn > 0 {
		os.Exit(1)
	}
}
