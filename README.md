# MIFX — Machining Intent Format eXchange

MIFX is an open, vendor-neutral specification for portable exchange of structured machining intent between manufacturing systems.

The format defines a deterministic core data model for representing:

- Ordered setups
- Ordered operations
- Tool identity and references
- Explicit coordinate transformations
- References to machine-neutral motion data (ISO 4343 APT/CL)

MIFX packages machining process information into a portable `.mifx` archive using a structured filesystem layout and JSON-based object descriptions.

The format defines **data structure only**.  
It does not define execution behavior, controller dialects, simulation, or lifecycle management.

---

## Status

**Version 1.1 — Core Frozen**

Earlier XML and transitional JSON representations are now superseded by the canonical package structure defined in this specification.

---

## Specification

The official specification is available here:
