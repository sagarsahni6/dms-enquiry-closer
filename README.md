# Hero DMS Enquiry Closer

A robust, enterprise-grade Google Chrome and Microsoft Edge extension (Manifest V3) designed to automate, bulk close, and auto-repair enquiry records within the **Hero MotoCorp eDealer Siebel DMS** (`HHML eAuto Contact Opportunity Activities View`).

---

## Key Features

- **Bulk Processing via Excel / CSV**: Import hundreds or thousands of enquiry numbers (`.xlsx`, `.xls`, `.csv`) with instant batch parsing and deduplication.
- **Force Close Engine**:
  - Automatically resolves mandatory missing fields: customer phone numbers, follow-up status, next follow-up dates, lost competition details, and customer remarks.
  - **Cascading Address Repair**: Fixes blank address records by auto-resolving hierarchical Siebel LOVs (`Country` → `State` → `District` → `Tehsil` → `City` → `Pin Code`).
- **SBL-DAT-00523 Concurrency & Rowstamp Auto-Recovery**:
  - Detects and resolves the infamous Siebel error: *"The selected record has been modified by another user since it was retrieved. Please continue. (SBL-DAT-00523)"*.
  - Eliminates stale client-side rowstamps by querying the record before commit and intelligently retrying with fresh BusComp data.
- **NVIDIA NIM AI Auto-Recovery**:
  - Built-in integration with NVIDIA NIM reasoning models (e.g. `meta/llama-3.1-70b-instruct`, `nvidia/nemotron-4-340b-instruct`).
  - Automatically diagnoses complex Siebel Business Component validation errors, inspects active LOVs, and synthesizes corrective field actions.
- **Safe Mode & Dry Run**: Validate records and test query accuracy without modifying production data.
- **Real-Time UI & Reporting**: Live execution status, skip detection for already closed enquiries, pause/resume/stop controls, retry failed batches, and CSV export.

---

## Extension Architecture

```
dms-enquiry-closer/
├── manifest.json              # Manifest V3 extension configuration
├── sidepanel.html             # Main control panel UI
├── sidepanel.js               # UI logic, state management, and settings
├── sidepanel.css              # Sidepanel styles and status badges
├── background/
│   └── service_worker.js      # Background service worker & sidepanel activation
├── content/
│   ├── content_runner.js      # Automation runner & execution orchestrator
│   ├── siebel_bridge.js       # Main-world script interacting with Siebel Open UI BusComps
│   └── dom_observer.js        # DOM observer capturing Siebel error dialogs & popups
├── lib/
│   ├── batch_parser.js        # Excel & CSV parser with regex normalization
│   ├── nim_client.js          # NVIDIA NIM API client & recovery validator
│   └── xlsx.full.min.js       # Standalone SheetJS library
└── icons/                     # Extension branding icons
```

---

## Installation

### Prerequisites
- Google Chrome or Microsoft Edge (Chromium-based browser).
- Access to Hero MotoCorp eDealer Portal (`connect.heromotocorp.biz`).

### Load Unpacked Extension
1. Clone this repository:
   ```bash
   git clone https://github.com/sagarsahni6/dms-enquiry-closer.git
   ```
2. Open your browser and navigate to:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`
3. Enable **Developer mode** (toggle switch in the top-right or sidebar).
4. Click **Load unpacked** and select the `dms-enquiry-closer` folder from the repository.
5. Pin the **Hero DMS Enquiry Closer** extension to your browser toolbar.

---

## Usage Guide

1. Log in to your Hero MotoCorp eDealer DMS portal and navigate to the **Enquiry / Opportunity Activities** view.
2. Click the extension icon in your browser toolbar to open the sidepanel.
3. Configure your closing parameters:
   - **Enquiry Status**: `Closed`
   - **Close Reason**: `Lost To Competition`, `Customer Cancelled`, etc.
   - **Sub Reason**: Specific sub-category matching the active dealer LOV.
   - **Lost To Competitor / Make / Model**: (If closing as lost to competitor).
4. Select or upload enquiry numbers:
   - Paste enquiry IDs into the text area (e.g., `11365-01-SENQ-0626-1617`), or
   - Upload an Excel/CSV file containing an `Enquiry Number` column.
5. (Optional) Enable **Force Close Mode** to automatically bypass missing address and follow-up validation blocks.
6. (Optional) Provide your **NVIDIA NIM API Key** under AI settings for automated reasoning and error repair.
7. Click **Start Force Close** or **Start Closing**.

---

## Testing & Quality Assurance

The project includes an end-to-end mock Siebel Open UI environment driven by Playwright and native Node.js unit tests.

### Run Unit Tests
```bash
npm run test:unit
```
Runs tests for:
- Batch Excel/CSV parser and enquiry number extraction.
- NVIDIA NIM API endpoint negotiation, JSON repair, prompt sanitization, and LOV validation.

### Run End-to-End Simulation
```bash
npm run test:e2e
```
Simulates the Siebel Open UI architecture (`SiebelApp.S_App`, BusComps, Applets, SweetAlert popups) across 8 automated scenarios:
1. Dry Run verification
2. Live closing execution
3. Retry failed records with manual fallbacks
4. Force Close mode with address repair cascades
5. Concurrency recovery for `SBL-DAT-00523` conflicts
6. Double-commit conflict avoidance
7. NVIDIA NIM AI error diagnosis and automated field patching
8. Concurrency collision auto-refresh

### Run All Tests
```bash
npm test
```

---

## License

This project is proprietary and intended for authorized Hero MotoCorp dealer operations.
