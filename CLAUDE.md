# SQL Visualizer

See README.md for what the app does and HANDOFF.md for architecture notes.

## Design Context

### Users
Students in Berkeley's DATA C88C class (built by Qamil Mirza; not affiliated with the course). They arrive while studying or doing homework, usually with a query in mind that they don't fully understand. The job: see how SQL manipulates and transforms tables, one clause at a time, until the logical order of evaluation clicks. Many are new to SQL and may feel a bit intimidated by it.

### Brand Personality
Calm, confident, clear. The interface should feel like a well-made textbook: quiet, spacious, unhurried, and trustworthy. Emotional goal: "SQL is understandable." It should lower anxiety, not add excitement. Copy is plain and direct, never hype-y.

### Aesthetic Direction
- Light mode only. Builds on the existing green accent (`#43a047` family, matching the favicon) with tinted neutrals; the purple secondary stays a minor supporting color.
- Minimal: generous whitespace, few elements, strong typographic hierarchy doing the work that boxes and cards would otherwise do.
- Tables are the subject matter; the visual language can borrow from them (rules, columns, rows) rather than from decorative illustration.
- Anti-references:
  - Generic SaaS landing pages (hero + feature-card grid + gradient buttons).
  - Anything that reads as an official Berkeley course site (no Berkeley blue/gold, no seals or university branding). The non-affiliation disclaimer must be visible.
  - Dark "hacker" aesthetics (neon on black, terminal styling).

### Design Principles
1. **Clarity over decoration.** Every element must help a student understand SQL or get started; remove anything that doesn't.
2. **Let typography and space carry hierarchy.** Prefer rules, alignment, and scale over cards, shadows, and containers.
3. **Calm motion.** Motion only to explain state changes; smooth deceleration, no bounce; respect `prefers-reduced-motion`.
4. **One product.** The landing page and the visualizer share the same type, color, and spacing system.
5. **Honest framing.** Be clear about who built it and that it is unofficial.
