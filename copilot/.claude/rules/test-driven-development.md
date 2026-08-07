# Test-driven development

Tests come before implementation. Failing tests drive the design.

## The rule

Red → Green → Refactor:

1. **Red:** write a test that captures one behavior from the spec. Run it. It must fail for the right reason.
2. **Green:** write the *minimum* code to make the test pass. No extra features, no speculative abstractions.
3. **Refactor:** with the test as a safety net, clean up the code. Tests must still pass.

Repeat per behavior in the spec.

## What counts as a test

- **Unit tests** for pure logic.
- **Integration tests** for code that crosses a boundary (DB, network, filesystem).
- **E2E tests** for user-visible behavior, at least once per critical flow.

A "test" that imports the implementation and asserts `true === true` does not count.

## Why

- Forces design from the *caller's* perspective before the internals are decided.
- Catches regressions during refactor.
- Documents intent in a form that is checked on every commit.

## How to apply

- Every PR with new behavior must include tests for that behavior. No exception for "trivial" changes — trivial changes are where bugs hide.
- If a bug is found, write a failing test that reproduces it BEFORE fixing. The test stays in the suite.
- Mock at the boundary (HTTP client, DB driver), not internal collaborators. If you need to mock an internal class to test it, that class probably has the wrong shape.
- *Behavior coverage* is the goal, not line coverage. 100% line coverage with no assertions is worthless.

## Anti-patterns

- Writing tests after the implementation only to confirm what you wrote. (You won't catch the bug you didn't think of.)
- Tests that depend on each other's order.
- Tests that assert on implementation details (private methods, internal state) instead of observable behavior.
- Disabling a failing test to "fix later." Either fix it or delete it.
