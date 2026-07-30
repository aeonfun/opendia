# Releasing

The npm package (`opendia`) lives in `opendia-mcp/`. Publishing is automated by
GitHub Actions (`.github/workflows/publish.yml`) using npm **OIDC trusted
publishing**. There is no `NPM_TOKEN` secret; auth happens over OIDC and a
provenance attestation is attached to every release.

Any git tag matching `v*` triggers a publish of the version currently in
`opendia-mcp/package.json`.

## Cut a release

Because the package is in a subdirectory, running `npm version` inside
`opendia-mcp/` bumps the version but does **not** create the git tag (npm only
tags when run at the repo root). So bump without tagging, then commit and tag from
the repo root:

```
cd opendia-mcp && npm version patch --no-git-tag-version
cd ..
git commit -am "chore(release): X.Y.Z"
git tag vX.Y.Z
git push --follow-tags
```

CI then runs `npm publish --provenance` on Node 24 in `opendia-mcp/` (npm 11+ is
required for OIDC).

## Notes

- Trusted publisher is configured on npmjs.com (package Settings -> Trusted
  Publisher), pointing at `aeonfun/opendia` + `publish.yml`. If you rename the repo
  or the workflow file, update it there or publishes will start failing.
- Node 24 in CI is deliberate: OIDC trusted publishing needs npm >= 11.5, which
  Node 20 does not ship.
- The workflow publishes from `opendia-mcp/` via `defaults.run.working-directory`.
