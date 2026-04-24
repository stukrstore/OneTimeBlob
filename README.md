# BlobOneTimeAPI (Node.js)

Databricks SQL 쿼리 결과를 ADLS Gen2 Blob에 저장하고, One-time SAS URL을 생성하는 REST API

## Architecture

```mermaid
flowchart TD
    A["Client"] -->|"POST /api/getOnetimeURL<br/>{ query, id, useShortUrl }"| B["Express API Server"]
    B -->|"Azure AD Token<br/>(DefaultAzureCredential)"| C["Databricks SQL Warehouse"]
    C -->|"Query Result"| B
    B -->|"CSV 변환"| D["ADLS Gen2 Blob Storage<br/>api/audience/{id}/data.csv"]
    D -->|"Upload 완료"| E{"useShortUrl?"}
    E -->|"Yes"| F["Short URL 생성<br/>/s/{code}<br/>(1회용, 5분 만료)"]
    E -->|"No"| G["SAS URL만 반환"]
    F --> H["Response<br/>{ location, sas-url, short-url }"]
    G --> H

    style A fill:#4a90d9,color:#fff
    style B fill:#f5a623,color:#fff
    style C fill:#7b68ee,color:#fff
    style D fill:#28a745,color:#fff
    style F fill:#e74c3c,color:#fff
    style H fill:#17a2b8,color:#fff
```

## Infrastructure

- **Databricks Workspace**: https://adb-1949729781658890.10.azuredatabricks.net
- **Blob Storage**: https://mskrblobonetime.dfs.core.windows.net/
- **Authentication**: Azure Managed Identity
  - Local: VM Managed Identity
  - Production: AKS Workload Identity (UAMI)
  - RBAC: Storage Blob Data Contributor

### Storage Paths

| Environment | Storage Account | Path |
|---|---|---|
| PRD | xxxxxprdex | api/audience/{id}/ |
| STG | xxxxxstgex | api/audience/{id}/ |
| DEV | xxxxxdevex | api/audience/{id}/ |

### DW Table

`cat_common_prd.meta.current_dw_user_info`

## Setup

### 1. Install dependencies

```bash
cd NodeJS/BlobOneTimeAPI
npm install
```

### 2. Configure environment variables

```bash
cp .env.example .env
# .env 파일을 열어 DATABRICKS_HTTP_PATH 등을 수정
```

#### Environment Variables

| Variable | Description | Default |
|---|---|---|
| `DATABRICKS_HOST` | Databricks workspace URL | (required) |
| `DATABRICKS_HTTP_PATH` | SQL Warehouse HTTP path | (required) |
| `STORAGE_ACCOUNT` | Azure Storage account name | `mskrblobonetime` |
| `STORAGE_CONTAINER` | Blob container name | `api` |
| `SAS_EXPIRY_MINUTES` | SAS URL expiry time (minutes) | `5` |
| `PORT` | Server port | `3000` |
| `AUTH_USER` | Test page login username | - |
| `AUTH_PASS` | Test page login password | - |

### 3. Run

```bash
npm start        # production
npm run dev      # development (auto-reload)
```

## API

### POST /api/getOnetimeURL

#### Request

```json
{
    "query": "SELECT C_CUSTKEY, C_NAME, C_ADDRESS, C_NATIONKEY, C_PHONE, C_ACCTBAL, C_MKTSEGMENT, C_COMMENT FROM mskr_databricks.tpch.customer LIMIT 1;",
    "id": "100"
}
```

#### Response

```json
{
    "location": "abfss://api@mskrblobonetime.dfs.core.windows.net/audience/100/data.csv",
    "one-time-url": "https://mskrblobonetime.blob.core.windows.net/api/audience/100/data.csv?sv=..."
}
```

#### Error Response

```json
{
    "error": "query and id are required"
}
```

## Test Page

브라우저에서 `http://localhost:3000/test` 접속 시 Basic Auth 인증 후 React 기반 테스트 UI를 사용할 수 있습니다.

- SQL Query와 ID에 default 값이 세팅되어 있으며 수정 가능
- 실행 결과의 one-time-url 클릭으로 파일 다운로드 확인 가능

## Project Structure

```
NodeJS/BlobOneTimeAPI/
├── package.json
├── .env.example
├── .env                  # (git ignored)
├── .gitignore
├── public/
│   └── index.html        # React test page
├── src/
│   ├── server.js         # Entrypoint
│   ├── app.js            # Express routes + auth middleware
│   ├── config.js         # Environment config
│   ├── databricks.js     # Databricks SQL execution
│   └── blob.js           # Blob upload + SAS URL generation
└── README.md
```

## Blob Lifecycle Management Policy

One-time URL로 생성된 파일은 일정 기간 후 자동 삭제되도록 Azure Blob Storage Lifecycle Management Policy를 설정합니다.

### Azure Portal에서 설정

1. Azure Portal → Storage Account → **Data management** → **Lifecycle management**
2. **+ Add a rule** 클릭
3. 아래와 같이 설정:

| 항목 | 값 |
|---|---|
| Rule name | `delete-audience-after-7days` |
| Rule scope | Limit blobs with filters |
| Blob type | Block blobs |
| Blob subtype | Base blobs |
| Prefix match | `api/audience/` |
| Days after last modification | `7` |
| Action | Delete the blob |

### Azure CLI로 설정

```bash
az storage account management-policy create \
  --account-name <STORAGE_ACCOUNT> \
  --resource-group <RESOURCE_GROUP> \
  --policy @lifecycle-policy.json
```

`lifecycle-policy.json`:

```json
{
  "rules": [
    {
      "enabled": true,
      "name": "delete-audience-after-7days",
      "type": "Lifecycle",
      "definition": {
        "actions": {
          "baseBlob": {
            "delete": {
              "daysAfterModificationGreaterThan": 7
            }
          }
        },
        "filters": {
          "blobTypes": ["blockBlob"],
          "prefixMatch": ["api/audience/"]
        }
      }
    }
  ]
}
```

### Terraform으로 설정

```hcl
resource "azurerm_storage_management_policy" "audience_cleanup" {
  storage_account_id = azurerm_storage_account.this.id

  rule {
    name    = "delete-audience-after-7days"
    enabled = true

    filters {
      prefix_match = ["api/audience/"]
      blob_types   = ["blockBlob"]
    }

    actions {
      base_blob {
        delete_after_days_since_modification_greater_than = 7
      }
    }
  }
}
```

### 참고사항

- Lifecycle policy는 **하루 1회** 실행되므로 정확히 7일이 아닌 7~8일 사이에 삭제될 수 있음
- `api/audience/` prefix에만 적용되므로 다른 컨테이너 데이터에는 영향 없음
- 환경별(PRD/STG/DEV) Storage Account 각각에 동일하게 설정 필요
