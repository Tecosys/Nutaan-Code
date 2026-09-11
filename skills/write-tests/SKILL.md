---
name: write-tests
description: Write tests for existing code. Use when the user asks to add tests, write unit tests, or improve test coverage.
---

1. First check what test framework and conventions the project already uses (look at an existing test file, or package.json/requirements for jest/vitest/pytest/etc.) — never introduce a second framework into a project that already has one.
2. Test behavior, not implementation. Cover: the normal/happy path, boundary values (empty input, zero, negative, max size), and at least one realistic failure case (invalid input, a dependency erroring).
3. One assertion concept per test, with a name that describes the scenario (e.g. "returns 0 for an empty array", not "test1").
4. Don't write a test that can never fail (an assertion that's trivially true) or one that's so loose it wouldn't catch a real regression.
5. Run the tests after writing them (via run_command) to confirm they actually pass against the current code before calling the task done.
