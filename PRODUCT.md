# Product

## Register

product

## Users

Operators who manage multiple ChatGPT Team workspaces. They use the app to keep parent accounts usable, invite or remove members, change member seat types, and avoid accidental ChatGPT seat overages.

## Product Purpose

team-manager is a private operations console for ChatGPT Team parent accounts. It stores sensitive session credentials outside git, calls ChatGPT Web backend APIs through a Cloudflare-compatible transport, and gives operators a cached, low-friction view of workspace status and member actions.

## Brand Personality

Practical, restrained, task-focused. The interface should feel like an internal operations tool: dense enough for repeated work, explicit about risk, and quiet unless an action can affect billing or credentials.

## Anti-references

Avoid marketing-page composition, large decorative cards, modal-first workflows, slow blocking refresh states, one-note color themes, and dangerous actions exposed as primary buttons.

## Design Principles

- Keep high-risk actions visible only at the point of use, with inline confirmation.
- Prefer cached data and background progress over blocking page states.
- Apply ordinary seat, role, and settings changes directly; reserve confirmation for destructive actions, immediate charges, credential exposure, or scarce quota consumption.
- Use compact tables and stable row heights for repeated account operations.
- Store raw API evidence in docs with strict sanitization when behavior is discovered through ChatGPT Web.

## Accessibility & Inclusion

Target WCAG AA for contrast and keyboard focus. Loading, disabled, destructive, and error states must be represented with text and visual state, not color alone. Reduced-motion users should not receive decorative animation.
