# Cursor attribution (must stay OFF)

IDE: **Cursor Settings → Git & Pull Requests → Attribution** → turn **Commit Attribution** and **PR Attribution** OFF.

CLI (`~/.cursor/cli-config.json`):

```json
"attribution": {
  "attributeCommitsToAgent": false,
  "attributePRsToAgent": false
}
```

Repo hook `.git/hooks/commit-msg` strips Cursor trailers if they are injected anyway.
