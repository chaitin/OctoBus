### 联调证据：GetAsset 通过 OctoBus 跑通

```http
# Request
POST http://127.0.0.1:19016/capsets/jumpserver-real-v41016/connect/jumpserver-real-v41016/JumpServer_Bastionhost_V41016.JumpServer_Bastionhost_V41016/GetAsset
Content-Type: application/json

{
  "id": "df3f5e8a-f929-4dfd-89b1-02acb7391665"
}

# Upstream request produced by OctoBus service
GET http://10.2.36.xxx/api/v1/assets/assets/df3f5e8a-f929-4dfd-89b1-02acb7391665/
Authorization: Bearer ******
Accept: application/json

# Response   HTTP/1.1 200 OK
Content-Type: application/json

{
  "asset": {
    "id": "df3f5e8a-f929-4dfd-89b1-02acb7391665",
    "name": "1",
    "address": "******",
    "platform": "Linux",
    "category": "Host",
    "type": "Linux",
    "comment": "",
    "raw_json": {
      "id": "df3f5e8a-f929-4dfd-89b1-02acb7391665",
      "name": "1",
      "address": "******",
      "zone": null,
      "platform": {
        "id": 1,
        "name": "Linux",
        "type": "linux"
      },
      "nodes": [
        {
          "id": "cde3b14e-12f7-4fba-ac74-e634592b946c",
          "name": "DEFAULT"
        }
      ],
      "labels": [],
      "protocols": [
        {
          "name": "sftp",
          "port": 22
        },
        {
          "name": "ssh",
          "port": 22
        }
      ],
      "nodes_display": [
        "/DEFAULT"
      ],
      "accounts": [],
      "directory_services": [],
      "accounts_amount": 0,
      "category": {
        "value": "host",
        "label": "Host"
      },
      "type": {
        "value": "linux",
        "label": "Linux"
      },
      "connectivity": {
        "value": "-",
        "label": "Unknown"
      },
      "auto_config": {
        "su_enabled": true,
        "gateway_enabled": true,
        "ansible_enabled": true,
        "id": 1,
        "ansible_config": {
          "ansible_connection": "smart"
        },
        "ping_enabled": true,
        "ping_method": "posix_ping",
        "ping_params": {},
        "gather_facts_enabled": true,
        "gather_facts_method": "gather_facts_posix",
        "gather_facts_params": {},
        "change_secret_enabled": true,
        "change_secret_method": "change_secret_posix",
        "change_secret_params": {},
        "push_account_enabled": true,
        "push_account_method": "push_account_posix",
        "push_account_params": {
          "home": "",
          "sudo": "/bin/whoami",
          "shell": "/bin/bash",
          "groups": ""
        },
        "verify_account_enabled": true,
        "verify_account_method": "verify_account_posix",
        "verify_account_params": {},
        "gather_accounts_enabled": true,
        "gather_accounts_method": "gather_accounts_posix",
        "gather_accounts_params": {},
        "remove_account_enabled": true,
        "remove_account_method": "remove_account_posix",
        "remove_account_params": {},
        "platform": 1
      },
      "org_id": "00000000-0000-0000-0000-000000000002",
      "org_name": "DEFAULT",
      "gathered_info": {},
      "spec_info": {},
      "is_active": true,
      "date_verified": null,
      "date_created": "2026/06/25 14:37:19 +0800",
      "date_updated": "2026/06/25 14:37:19 +0800",
      "comment": "",
      "created_by": "Administrator"
    }
  },
  "raw_json": {
    "id": "df3f5e8a-f929-4dfd-89b1-02acb7391665",
    "name": "1",
    "address": "******",
    "zone": null,
    "platform": {
      "id": 1,
      "name": "Linux",
      "type": "linux"
    },
    "nodes": [
      {
        "id": "cde3b14e-12f7-4fba-ac74-e634592b946c",
        "name": "DEFAULT"
      }
    ],
    "labels": [],
    "protocols": [
      {
        "name": "sftp",
        "port": 22
      },
      {
        "name": "ssh",
        "port": 22
      }
    ],
    "nodes_display": [
      "/DEFAULT"
    ],
    "accounts": [],
    "directory_services": [],
    "accounts_amount": 0,
    "category": {
      "value": "host",
      "label": "Host"
    },
    "type": {
      "value": "linux",
      "label": "Linux"
    },
    "connectivity": {
      "value": "-",
      "label": "Unknown"
    },
    "auto_config": {
      "su_enabled": true,
      "gateway_enabled": true,
      "ansible_enabled": true,
      "id": 1,
      "ansible_config": {
        "ansible_connection": "smart"
      },
      "ping_enabled": true,
      "ping_method": "posix_ping",
      "ping_params": {},
      "gather_facts_enabled": true,
      "gather_facts_method": "gather_facts_posix",
      "gather_facts_params": {},
      "change_secret_enabled": true,
      "change_secret_method": "change_secret_posix",
      "change_secret_params": {},
      "push_account_enabled": true,
      "push_account_method": "push_account_posix",
      "push_account_params": {
        "home": "",
        "sudo": "/bin/whoami",
        "shell": "/bin/bash",
        "groups": ""
      },
      "verify_account_enabled": true,
      "verify_account_method": "verify_account_posix",
      "verify_account_params": {},
      "gather_accounts_enabled": true,
      "gather_accounts_method": "gather_accounts_posix",
      "gather_accounts_params": {},
      "remove_account_enabled": true,
      "remove_account_method": "remove_account_posix",
      "remove_account_params": {},
      "platform": 1
    },
    "org_id": "00000000-0000-0000-0000-000000000002",
    "org_name": "DEFAULT",
    "gathered_info": {},
    "spec_info": {},
    "is_active": true,
    "date_verified": null,
    "date_created": "2026/06/25 14:37:19 +0800",
    "date_updated": "2026/06/25 14:37:19 +0800",
    "comment": "",
    "created_by": "Administrator"
  }
}
```
