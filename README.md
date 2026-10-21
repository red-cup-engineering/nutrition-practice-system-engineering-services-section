# Nutrition Practice System Services Section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

This engineering section owns the computer system through which a practitioner
works with nutrition resources, personal intake/recipe records, explicit
uncertainty, and later deliberately shared care records.

Read the upstream [nutrition science and computer-system
architecture](../../../../../../../../../../../science-services-section/services/natural-science-services-section/services/biological-science-services-section/services/medical-science-services-section/services/medical-services-section/services/health-services-section/services/nutrition-services-section/content/text/documents/articles/notes/2026/08/19/2026-08-19-nutrition-science-and-computer-system-architecture.md)
before admitting application behavior.

Durable practitioner records live in the [personal nutrition state
section](../../../../../../../../../../../public-services-section/services/personal-services-section/services/emsenn-services-section/services/emsenn-medical-services-section/services/health-services-section/services/emsenn-nutrition-services-section/),
not in this computer system.

## Admitted application

- `apps/nutrition-practice-computer` — pure application core and port
  contracts; it has no ambient filesystem, network, barcode camera, health
  provider, credential, or clock.

The browser face, source adapters, local-state adapter, and care exchange are
distinct adapters/services. Naming a future integration does not admit it.
