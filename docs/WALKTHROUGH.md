# Example walkthrough

The `examples/hello` folder is a small Express service with an optional PostgreSQL Compose service. Copy it to a working directory, run `npm install`, initialize Git, set your user identity, add the source and lockfile and commit. Edit the response message without committing and add an untracked notes file.

Set `LOCAL_DB_PASSWORD` through your protected development environment, review `compose.yaml` and run `docker compose up -d`. The PostgreSQL port must be available. Connect to `teleport_dev` and create a sample table with records. Set `DEV_DATABASE_URL` to the local database connection and inspect the `devteleport.json` adapter.

Run `devteleport inspect`, review `devteleport capture --name hello --dry-run`, then capture with `--include-db --output /path/to/snapshots`. Copy `hello.dtp` to the destination machine. Install Node 24, DevTeleport and PostgreSQL utilities there.

Create an empty independent development database. Create a trusted target mapping outside the restored workspace using a destination connection environment variable. Review `restore --dry-run`, then restore with `--target /path/to/hello-restored --restore-db --approve-db --db-config /path/to/target.json`. Review source scripts before separately approving `npm ci` or adding `--install --approve-execution` to the restore command.

Verify files and Git status, inspect the restored database records, run `npm start` and visit localhost port 3000. Use the VS Code extension to reopen supported saved tabs. Keep the original project until verification succeeds.

The automated Express test performs an independent-directory restore with the source removed, checks uncommitted and untracked state, installs dependencies with explicit execution approval and makes a real HTTP request. The separate PostgreSQL test removes the source database before restoration. `npm run test:full` combines real Express/Git/PostgreSQL/Compose configuration capture and approved restore, removes the source folder and database, and verifies a database-backed HTTP response. None of these tests are physical two-machine validation.
