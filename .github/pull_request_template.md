## Summary

<!-- Briefly describe what this PR does and why. Link any relevant issues. -->

## Type of Change

<!-- Check all that apply -->

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Refactor (code changes that neither fix a bug nor add a feature)
- [ ] Documentation update
- [ ] Breaking change (fix or feature that would cause existing functionality to change)

## Security Checklist

The MCP server handles sensitive operations (wallets, credentials, authentication).
Please confirm the following:

- [ ] This PR does **not** touch wallet, credential, or auth code.
- [ ] This PR **does** touch wallet, credential, or auth code. If checked, describe the changes and any security implications below:

  <details>
  <summary>Security impact</summary>

  <!-- Describe what sensitive code is modified and how it was verified safe. -->

  </details>

- [ ] No secrets, private keys, or tokens are committed in this PR.
- [ ] No new dependencies introduce known vulnerabilities.

## Testing Checklist

- [ ] `npm run build` passes (`tsc` compiles without errors)
- [ ] Type checking passes (`npx tsc --noEmit`)
- [ ] Tests pass (`npm test`)
- [ ] I have manually tested the affected tools in an MCP client
- [ ] I have added/updated tests for new behavior (if applicable)

## Breaking Changes

<!-- If this PR introduces breaking changes, describe them and note any migration steps. -->

None.

## Related Issues

<!-- List any issues this PR closes or relates to. Example: Closes #123 -->
