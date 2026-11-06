# Subiekt bridge integration review — 2026-11-06

The server client sends the Cloudflare Access token pair alongside its bridge bearer token. Redirects are rejected to prevent forwarding custom credentials to another origin. Known upstream error codes map to local messages; raw error text is never persisted or displayed.

Numeric financial fields reject null, empty strings and booleans. When header totals are provided, the client compares them with the row totals in cents. A discrepancy greater than one cent rejects the refresh and retains the previous snapshot and timestamp.

The bridge now takes revenue from invoice headers. Ambiguous advances/final invoices are allocated using the linked order's current goods/service proportions, separately for net and gross. This policy was approved by the owner on 2026-11-06. Exact invoice splits are preserved. Invalid or absent allocation bases remain unallocated; rounding residuals remain visible separately. Updating an order can therefore affect a later refresh of its allocation.

The UI explains this policy and the meaning of unallocated rows. It still requires an explicit Apply action to change an application's revenue cell.

Validation completed locally: Subiekt client, redirect, snapshot and UI regression tests; application type check and production webpack build. Read-only live bridge validation reconciled grouped values against headers over twelve months and compared local REST, Cloudflare REST and MCP. Actual business amounts and private evidence are stored outside this public repository.

The previous full Windows test run was not green. Linux-specific dependencies and failures require a full Linux run; the image workflow now runs that suite before building or publishing an image. A build does not deploy to Coolify. Production deployment requires approval of the exact image digest and a migration check on a database copy.
