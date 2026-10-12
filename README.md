# Nutrition Practice System Services Section

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
