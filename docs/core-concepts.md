## Core Concepts

Loomit is built around a few core concepts. Understanding them makes the rest of the documentation much easier to follow.

### Project

A **Project** represents a single garment under development.

It contains the pattern parts, project configuration, prototype notes, and the history of design decisions for that garment. A project can be forked to explore alternative designs without affecting the original.

### Part

A **Part** is a reusable pattern component, such as a body, sleeve, collar, or cuff.

Parts are the primary building blocks of a garment. They can evolve independently within a project, and an entire project can be forked to reuse its parts as a new starting point.

### Prototype Notes

**Prototype Notes** capture knowledge gained while making physical prototypes.

They record observations such as fit issues, construction problems, and ideas for future improvements. They represent the maker's experience rather than the current state of the pattern.

### Diff

A **Diff** describes how a design changed, not just how files changed.

Instead of showing only text differences, Loomit aims to explain meaningful pattern changes such as modified dimensions, moved darts, or updated design features. Diffs provide context for design reviews and help track the evolution of a garment.

### Variant

A **Variant** identifies a different design of the same part.

Variants are alternatives rather than newer versions. A puff sleeve and a bishop sleeve are different design choices, not different stages of the same part.
