// MBS API Test Client (Go) - 直接调用 MBS REST API
// 用法见 HELP.md
package main

import (
	"bytes"
	"crypto/md5"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

var cfg = struct{ B, O, A, S string }{
	B: envOr("MBS_BASE_URL", "https://127.0.0.1:9074"),
	O: os.Getenv("MBS_ORG_CODE"),
	A: os.Getenv("MBS_APPKEY"),
	S: os.Getenv("MBS_SECRETKEY"),
}

const apiBase = "/uusafe/mos/thirdaccess/rest/opt"
const uid1 = "1691979294102310912" // test1
const uid2 = "1691979421122613248" // test2

var pass, failn, skipn int

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func requireConfig() {
	var missing []string
	for key, value := range map[string]string{"MBS_ORG_CODE": cfg.O, "MBS_APPKEY": cfg.A, "MBS_SECRETKEY": cfg.S} {
		if value == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		fmt.Fprintf(os.Stderr, "missing MBS test config: %s; set MBS_BASE_URL, MBS_ORG_CODE, MBS_APPKEY and MBS_SECRETKEY\n", strings.Join(missing, ", "))
		os.Exit(2)
	}
}

func md5s(s string) string                          { h := md5.Sum([]byte(s)); return fmt.Sprintf("%x", h) }
func sign(p ...string) string                       { return md5s(strings.Join(p, "") + cfg.S) }
func gf(m map[string]interface{}, k string) float64 { f, _ := m[k].(float64); return f }
func gs(m map[string]interface{}, k string) string  { s, _ := m[k].(string); return s }
func ok(s string, a ...interface{})                 { pass++; fmt.Printf("   ✅ PASS | "+s+"\n", a...) }
func fl(s string, a ...interface{})                 { failn++; fmt.Printf("   ❌ FAIL | "+s+"\n", a...) }
func sk(s string, a ...interface{})                 { skipn++; fmt.Printf("   ⏭️ SKIP | "+s+"\n", a...) }
func inf(s string, a ...interface{})                { fmt.Printf("   ℹ️  "+s+"\n", a...) }
func hdr(s string)                                  { fmt.Printf("\n── %s ──\n", s) }

func call(path string, body map[string]interface{}) (map[string]interface{}, error) {
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest("POST", cfg.B+apiBase+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	cl := &http.Client{Timeout: 30 * time.Second,
		Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}}
	resp, err := cl.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	rb, _ := io.ReadAll(resp.Body)
	var r map[string]interface{}
	json.Unmarshal(rb, &r)
	if c, _ := r["code"].(float64); c != 0 {
		return r, fmt.Errorf("code=%.0f", c)
	}
	return r, nil
}

func detail(uid string) (map[string]interface{}, error) {
	return call("/v1/detailUser", map[string]interface{}{
		"userId": uid, "orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid)})
}

// ═══ 场景1: test2 停用 (state=0) ═══
func s1() {
	hdr("场景1: test2 用户停用 (state=0)")
	inf("接口:stateUsers | 入参:userIds=[uid2],type=0,state=0 | 目标:code=0, state=0")
	_, e := call("/v1/stateUsers", map[string]interface{}{
		"userIds": []string{uid2}, "type": 0, "state": "0",
		"orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid2, "0", "0", "")})
	if e != nil {
		fl("失败:%v", e)
		return
	}
	ok("code=0")
	da, _ := detail(uid2)
	d := da["data"].(map[string]interface{})
	if gf(d, "state") == 0 {
		ok("test2.state=0 已停用")
	} else {
		fl("state=%.0f", gf(d, "state"))
	}
	call("/v1/stateUsers", map[string]interface{}{
		"userIds": []string{uid2}, "type": 0, "state": "1",
		"orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid2, "0", "1", "")})
	inf("已恢复 test2")
}

// ═══ 场景2: test1 停用 (state=0) ═══
func s2() {
	hdr("场景2: test1 停用 (state=0)")
	inf("接口:stateUsers | 入参:userIds=[uid1],type=0,state=0 | 目标:code=0, state=0")
	_, e := call("/v1/stateUsers", map[string]interface{}{
		"userIds": []string{uid1}, "type": 0, "state": "0",
		"orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid1, "0", "0", "")})
	if e != nil {
		fl("失败:%v", e)
		return
	}
	ok("code=0")
	da, _ := detail(uid1)
	d := da["data"].(map[string]interface{})
	if gf(d, "state") == 0 {
		ok("test1.state=0 已停用")
	} else {
		fl("state=%.0f", gf(d, "state"))
	}
	call("/v1/stateUsers", map[string]interface{}{
		"userIds": []string{uid1}, "type": 0, "state": "1",
		"orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid1, "0", "1", "")})
	inf("已恢复 test1")
}

// ═══ 场景3: test1 开启设备管控 (isMdm=1) ═══
func s3() {
	hdr("场景3: test1 开启设备管控 (isMdm=1)")
	inf("接口:updUser | 入参:userId=uid1,isMdm=1 | 目标:code=0,isMdm=1,state保持1")
	_, e := call("/v1/updUser", map[string]interface{}{
		"userId": uid1, "userName": "测试1", "loginName": "test1", "deptId": "1",
		"isMdm": 1, "orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid1, "测试1", "test1", "1")})
	if e != nil {
		fl("失败:%v", e)
		return
	}
	ok("code=0")
	da, _ := detail(uid1)
	d := da["data"].(map[string]interface{})
	if gf(d, "isMdm") == 1 {
		ok("isMdm=1 设备管控已开启")
	} else {
		fl("isMdm=%.0f", gf(d, "isMdm"))
	}
	inf("state=%.0f (应保持1)", gf(d, "state"))
}

// 6.2.1 GetUsers
func tGetUsers() {
	hdr("6.2.1 GetUsers - 用户列表")
	inf("入参:index=0,size=10 | 目标:total>=2")
	r, e := call("/v1/getUsers", map[string]interface{}{
		"index": 0, "size": 10, "orderCode": 0, "orderType": 1,
		"condition": map[string]interface{}{"deptId": "1", "keyWord": ""},
		"orgCode":   cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, "0", "10", "0", "1", "", "", "", "1")})
	if e != nil {
		fl("失败:%v", e)
		return
	}
	d := r["data"].(map[string]interface{})
	inf("total=%.0f", gf(d, "total"))
	if gf(d, "total") >= 2 {
		ok("total>=2")
	} else {
		fl("total=%.0f", gf(d, "total"))
	}
}

// 6.2.4 DetailUser
func tDetailUser() {
	hdr("6.2.4 DetailUser - 用户详情")
	r, e := detail(uid1)
	if e != nil {
		fl("失败:%v", e)
		return
	}
	d := r["data"].(map[string]interface{})
	inf("userName=%s state=%.0f isMdm=%.0f", gs(d, "userName"), gf(d, "state"), gf(d, "isMdm"))
	if gs(d, "loginName") == "test1" {
		ok("loginName=test1")
	} else {
		fl("loginName=%s", gs(d, "loginName"))
	}
}

// 6.2.6 StateUsers
func tStateUsers() {
	hdr("6.2.6 StateUsers - 启停用户")
	_, e := call("/v1/stateUsers", map[string]interface{}{
		"userIds": []string{uid2}, "type": 0, "state": "1",
		"orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid2, "0", "1", "")})
	if e != nil {
		fl("失败:%v", e)
	} else {
		ok("code=0")
	}
}

// 6.2.7 CheckLoginName
func tCheckLoginName() {
	hdr("6.2.7 CheckLoginName - 账号校验")
	inf("test1(已存在)→存在 | nonexistent_user→可用")
	r2, _ := call("/v1/checkLoginName", map[string]interface{}{
		"loginName": "test1", "orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, "test1")})
	inf("test1: code=%.0f msg=%s", gf(r2, "code"), gs(r2, "msg"))
	_, e := call("/v1/checkLoginName", map[string]interface{}{
		"loginName": "nonexistent_user", "orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, "nonexistent_user")})
	if e != nil {
		fl("失败:%v", e)
	} else {
		ok("nonexistent_user 可用")
	}
}

// 6.2.8 GetUserByPhone
func tGetUserByPhone() {
	hdr("6.2.8 GetUserByPhone - 手机号查询")
	_, e := call("/v1/getUserByPhone", map[string]interface{}{
		"phone": "13800138000", "orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, "13800138000")})
	if e != nil {
		fl("失败:%v", e)
	} else {
		ok("code=0")
	}
}

// 6.2.3 UpdUser
func tUpdUser() {
	hdr("6.2.3 UpdUser - 编辑用户")
	_, e := call("/v1/updUser", map[string]interface{}{
		"userId": uid1, "userName": "测试1", "loginName": "test1", "deptId": "1",
		"weight": 1, "orgCode": cfg.O, "appkey": cfg.A, "sign": sign(cfg.A, cfg.O, uid1, "测试1", "test1", "1")})
	if e != nil {
		fl("失败:%v", e)
	} else {
		ok("code=0")
	}
}

// 其余只写/危险操作跳过
func tAddUser()      { hdr("6.2.2 AddUser"); sk("生产环境跳过写操作") }
func tDelUsers()     { hdr("6.2.5 DelUsers"); sk("生产环境跳过写操作") }
func tUpdUserPwd()   { hdr("6.2.9/6.2.10 UpdUserPwd"); sk("生产环境跳过写操作") }
func tForceOffline() { hdr("6.2.11 ForceOffline"); sk("test1无在线会话") }
func tImportUser()   { hdr("6.2.12 ImportUser"); sk("需上传文件") }

func main() {
	requireConfig()
	tn := flag.String("test", "all", "test name: all|scenarios|apis|scenario1|getUsers|...")
	flag.Parse()
	all := map[string]func(){
		"scenario1": s1, "scenario2": s2, "scenario3": s3,
		"getUsers": tGetUsers, "addUser": tAddUser, "updUser": tUpdUser,
		"detailUser": tDetailUser, "delUsers": tDelUsers, "stateUsers": tStateUsers,
		"checkLoginName": tCheckLoginName, "getUserByPhone": tGetUserByPhone,
		"updUserPwd": tUpdUserPwd, "forceOffline": tForceOffline, "importUser": tImportUser}
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
		if fn, ok := all[*tn]; ok {
			fn()
		} else {
			fmt.Fprintf(os.Stderr, "unknown test: %s\n", *tn)
			os.Exit(1)
		}
	}
	fmt.Printf("\n═══════════════════════════════════\n")
	fmt.Printf("Results: %d passed, %d failed, %d skipped\n", pass, failn, skipn)
	if failn > 0 {
		os.Exit(1)
	}
}
