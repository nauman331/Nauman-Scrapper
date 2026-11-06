# REST API Reference: Web Scraping Platform

Base URL: `http://localhost:3000`

All endpoints return JSON responses. If `API_KEY` is configured in `.env`, all requests (except `/health` and `/ready`) require authentication via either:
- Header: `x-api-key: <your_key>`
- Header: `Authorization: Bearer <your_key>`

---

## 1. System & Health

### `GET /health`
Liveness probe.

**Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2026-10-23T08:36:21.827Z",
  "uptimeSeconds": 42,
  "memoryUsageMb": {
    "rss": 84,
    "heapTotal": 45,
    "heapUsed": 32
  }
}
```

### `GET /ready`
Readiness probe verifying database and queue connectivity.

**Response (200 OK):**
```json
{
  "status": "ok",
  "timestamp": "2026-10-23T08:36:21.842Z",
  "uptimeSeconds": 42,
  "memoryUsageMb": { ... },
  "checks": {
    "database": {
      "status": "up",
      "latencyMs": 4
    },
    "queue": {
      "status": "up",
      "adapter": "memory",
      "metrics": {
        "waiting": 0,
        "active": 0,
        "completed": 12,
        "failed": 0
      }
    }
  }
}
```

---

## 2. Scrape Jobs

### `POST /api/v1/jobs`
Creates and enqueues a new scraping job.

**Request Body:**
```json
{
  "name": "E-Commerce Scrape",
  "targetUrl": "https://books.toscrape.com/",
  "strategy": "AUTO",
  "priority": 5,
  "maxDepth": 2,
  "maxPages": 20,
  "requestTimeoutMs": 30000,
  "retryLimit": 3,
  "extractionConfig": {
    "extractMetadata": true,
    "extractHeadings": true,
    "extractMainText": true,
    "extractLinks": true,
    "discoverLinks": true,
    "filterInternalLinksOnly": true,
    "maxLinksPerPage": 50,
    "extractImages": true,
    "extractJsonLd": true,
    "customSelectors": [
      {
        "name": "price",
        "selector": ".price_color",
        "transform": "text"
      },
      {
        "name": "titles",
        "selector": "h3 > a",
        "attribute": "title",
        "multiple": true
      }
    ],
    "pagination": {
      "nextSelector": "li.next > a"
    },
    "requiredFields": ["title"]
  }
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "id": "cmvkpu4fk0001cw0r0za88tlc",
    "name": "E-Commerce Scrape",
    "targetUrl": "https://books.toscrape.com/",
    "domain": "books.toscrape.com",
    "strategy": "AUTO",
    "status": "PENDING",
    "priority": 5,
    "maxDepth": 2,
    "maxPages": 20,
    "requestTimeoutMs": 30000,
    "retryLimit": 3,
    "totalPagesCrawled": 0,
    "totalResultsExtracted": 0,
    "createdAt": "2026-10-23T08:36:21.878Z",
    "updatedAt": "2026-10-23T08:36:21.878Z"
  }
}
```

---

### `GET /api/v1/jobs`
List scraping jobs with filtering and pagination.

**Query Parameters:**
| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | - | Filter by `PENDING`, `RUNNING`, `COMPLETED`, `PARTIALLY_COMPLETED`, `FAILED`, `CANCELLED` |
| `domain` | string | - | Filter by target domain (e.g. `books.toscrape.com`) |
| `limit` | number | 20 | Items per page (max 100) |
| `offset` | number | 0 | Items to skip |
| `order` | string | `desc` | Sort order (`asc` or `desc` by `createdAt`) |

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "cmvkpu4fk0001cw0r0za88tlc",
      "targetUrl": "https://books.toscrape.com/",
      "status": "COMPLETED",
      "totalPagesCrawled": 12,
      "totalResultsExtracted": 12,
      "_count": {
        "results": 12,
        "crawledPages": 12,
        "attempts": 1
      }
    }
  ],
  "pagination": {
    "total": 1,
    "limit": 20,
    "offset": 0
  }
}
```

---

### `GET /api/v1/jobs/:id`
Retrieves full details of a specific job, including execution attempts and progress counts.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "cmvkpu4fk0001cw0r0za88tlc",
    "name": "E-Commerce Scrape",
    "targetUrl": "https://books.toscrape.com/",
    "domain": "books.toscrape.com",
    "strategy": "AUTO",
    "status": "COMPLETED",
    "totalPagesCrawled": 12,
    "totalResultsExtracted": 12,
    "startedAt": "2026-10-23T08:36:25.000Z",
    "finishedAt": "2026-10-23T08:36:31.000Z",
    "attempts": [
      {
        "id": "att_123",
        "attemptNumber": 1,
        "status": "COMPLETED",
        "workerId": "worker-prod-1"
      }
    ]
  }
}
```

---

### `POST /api/v1/jobs/:id/cancel`
Cancels an active or waiting job.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Job 'cmvkpu4fk0001cw0r0za88tlc' has been cancelled."
}
```

---

### `POST /api/v1/jobs/:id/retry`
Resets and re-enqueues a failed or cancelled job.

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Job 'cmvkpu4fk0001cw0r0za88tlc' re-enqueued for execution."
}
```

---

### `GET /api/v1/jobs/:id/results`
Returns extracted results for a job. Results are deduplicated via unique URL hashes (`[jobId, urlHash]`).

**Query Parameters:**
- `limit` (number, default: 50)
- `offset` (number, default: 0)
- `validationPassed` (boolean, `true` or `false`)

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "res_abc123",
      "url": "https://books.toscrape.com/catalogue/a-light-in-the-attic_1000/index.html",
      "title": "A Light in the Attic | Books to Scrape",
      "description": "It's hard to imagine a world without A Light in the Attic...",
      "validationPassed": true,
      "validationErrors": [],
      "normalizedData": {
        "title": "A Light in the Attic | Books to Scrape",
        "description": "...",
        "headings": { "h1": ["A Light in the Attic"], "h2": [], "h3": [] },
        "mainText": "...",
        "custom": {
          "price": "£51.77"
        }
      },
      "extractedAt": "2026-10-23T08:36:27.123Z"
    }
  ],
  "pagination": {
    "total": 12,
    "limit": 50,
    "offset": 0
  }
}
```

---

### `GET /api/v1/jobs/:id/pages`
Returns operational log records for each crawled HTTP response.

**Response (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "id": "page_xyz",
      "url": "https://books.toscrape.com/",
      "httpStatus": 200,
      "responseTimeMs": 142,
      "contentType": "text/html; charset=utf-8",
      "byteSize": 51420,
      "depth": 0,
      "crawlerStrategy": "CHEERIO",
      "crawledAt": "2026-10-23T08:36:26.000Z"
    }
  ],
  "pagination": {
    "total": 12,
    "limit": 50,
    "offset": 0
  }
}
```

---

## 3. Website Scraper → Next.js Project Generator

### `GET /api/v1/jobs/:jobId/conversion-preview`
Inspects the scraped snapshot and returns a page inventory, proposed routes, and metadata before conversion.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "jobId": "cmvkpu4fk0001cw0r0za88tlc",
    "targetUrl": "https://books.toscrape.com/",
    "domain": "books.toscrape.com",
    "totalPages": 12,
    "routes": ["/", "/catalogue/category/books_1", "/about"],
    "pages": [
      {
        "url": "https://books.toscrape.com/",
        "route": "/",
        "title": "All products | Books to Scrape - Sandbox",
        "componentName": "HomePage",
        "hasHeader": true,
        "hasFooter": true,
        "headingsCount": 14,
        "imagesCount": 20
      }
    ]
  }
}
```

---

### `POST /api/v1/conversions`
Starts converting a scraped job into a complete Next.js 16 App Router project with TypeScript.

**Request Body:**
```json
{
  "jobId": "cmvkpu4fk0001cw0r0za88tlc",
  "options": {
    "projectName": "books-store-app",
    "pages": ["https://books.toscrape.com/"],
    "cssStrategy": "original",
    "componentExtraction": "standard",
    "preserveInteractivity": true,
    "preserveMetadata": true,
    "typescript": true
  }
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "data": {
    "id": "conv_1793013472366_5e4ea154",
    "jobId": "cmvkpu4fk0001cw0r0za88tlc",
    "status": "PENDING",
    "currentStage": "validate-input",
    "stages": [
      { "id": "validate-input", "label": "Validate Input & Configuration", "status": "pending" },
      { "id": "load-scrape-snapshot", "label": "Load Scraped Pages & HTML", "status": "pending" },
      { "id": "build-page-inventory", "label": "Build Page & Route Inventory", "status": "pending" },
      { "id": "resolve-assets", "label": "Download & Resolve Assets", "status": "pending" },
      { "id": "analyze-page-structure", "label": "Analyze DOM & Layout Structure", "status": "pending" },
      { "id": "identify-shared-components", "label": "Identify Shared Layout & Components", "status": "pending" },
      { "id": "generate-nextjs-files", "label": "Generate Next.js App Router Project", "status": "pending" },
      { "id": "install-or-resolve-dependencies", "label": "Resolve Project Manifest & Configs", "status": "pending" },
      { "id": "run-static-validation", "label": "Run Static Code & Link Validation", "status": "pending" },
      { "id": "prepare-preview", "label": "Prepare Project Preview & File Tree", "status": "pending" },
      { "id": "package-project", "label": "Package Production ZIP Archive", "status": "pending" }
    ]
  },
  "message": "Next.js project generation started."
}
```

---

### `GET /api/v1/conversions/:id`
Returns real-time pipeline status, stage progress, validation diagnostics, and project file hierarchy.

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "id": "conv_1793013472366_5e4ea154",
    "status": "COMPLETED",
    "totalFilesGenerated": 28,
    "zipSizeBytes": 145920,
    "validationReport": {
      "passed": true,
      "checkedFilesCount": 16,
      "errors": [],
      "warnings": []
    },
    "fileTree": {
      "name": "project",
      "type": "directory",
      "children": [
        { "name": "app", "type": "directory" },
        { "name": "components", "type": "directory" },
        { "name": "public", "type": "directory" },
        { "name": "package.json", "type": "file" }
      ]
    }
  }
}
```

---

### `GET /api/v1/conversions/:id/download`
Streams the complete, standalone generated project as a ZIP archive.
Authentication: provide via `x-api-key` header, `Authorization: Bearer <key>`, or `?api_key=<key>` query parameter (for direct browser downloads).

---

### `GET /api/v1/conversions/:id/files/*`
Inspects individual generated file content directly in the browser.

