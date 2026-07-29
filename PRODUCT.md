# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

WallDecor CEO is an internal management portal for the company owner, administrators, managers, and employees.

- The owner and administrators use it to control finances, HR, recurring operations, and company knowledge.
- Managers review and correct records for employees within their organizational scope.
- Employees use the portal for personal workflows such as time registration and leave requests.

## Product Purpose

The portal consolidates operational work that would otherwise be handled in documents, spreadsheets, and separate systems. It should reduce repetitive manual work, make responsibilities clear, and preserve an auditable history of business decisions and corrections.

## Positioning

WallDecor CEO combines company-specific finance, HR, operations, and procedure workflows in one internal application. Its value comes from reflecting WallDecor's real organizational structure, terminology, and recurring processes rather than offering a generic administration template.

## Operating Context

- The application contains current production data and is deployed from GitHub through Coolify.
- Administrators and managers perform recurring reviews, approvals, corrections, and period-closing work.
- The interface is used primarily in Polish.
- Operational records may be entered late and must remain easy to review and correct.
- Role and organizational scope determine access to confidential HR and business data.

## Capabilities and Constraints

- Existing areas include finance, HR, operations, procedures, and the company encyclopedia.
- HR includes employee records, leave requests and approvals, work schedules, time registration, and reporting.
- Changes must preserve existing production records and their relationships.
- Administrative corrections must be explicit and auditable.
- New workflows should reuse existing role checks, organizational scope, and interface patterns.
- The application uses Next.js, Prisma, NextAuth roles, React, Tailwind CSS, and Lucide icons.

## Brand Commitments

- Product name: WallDecor CEO.
- Product language: concise, operational Polish.
- Existing WallDecor application identity and navigation remain authoritative for new modules.

## Evidence on Hand

- The repository contains the active application, schema, role policies, and production-oriented HR workflows.
- Existing UI tokens and component patterns are defined in `src/app/globals.css` and the current dashboard components.
- No testimonials, public marketing claims, or public product benchmarks are part of this internal product and none should be fabricated.

## Product Principles

- Prefer one clear operational source of truth over parallel manual records.
- Automate repetition while keeping consequential decisions reviewable.
- Preserve production data and expose an audit trail for administrative corrections.
- Keep frequent workflows compact, direct, and efficient.
- Extend established permissions and interface patterns instead of creating isolated subsystems.
