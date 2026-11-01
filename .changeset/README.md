# Changesets

A changeset is a small file saying which packages a change affects, how much, and what to tell consumers. Add one with a change
that a consumer would notice:

```sh
pnpm changeset
```

`core`, `ai`, and `source-github` share one version, so a change to any of them moves all three. See
[versioning and releases](../docs/learning/versioning-and-releases.md).
