Recommended branch protection for `main` (GitHub):

1. Settings → Branches → Add rule for `main`.
2. Require pull request reviews before merging (1 or 2 reviewers).
3. Require status checks to pass before merging: include `build`, `ci`, and `smoke` workflows.
4. Require linear history and disallow force pushes.
5. Restrict who can push to `main` (optional for very sensitive repos).

Set these rules before enabling automatic deploys to ensure every deploy is gated by CI & reviewer checks.
