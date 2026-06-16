# 同步 DB API 背后是远程 MySQL + worker,不是 sqlite

`db` 暴露同步的 better-sqlite3 风格 API(`db.prepare(sql).get/all/run`),但后端是远程 MySQL(vEDB)。我们用常驻 worker thread(mysql2 连接池)+ `Atomics.wait`(SharedArrayBuffer)把异步 MySQL 桥成同步调用,这样 `store.ts` 及所有 handler 零改动保留同步代码风格。

取这条路是因为:原先每个 query 都 `execFileSync` spawn 一个 node 子进程连远程 MySQL(~0.4s/query 且同步阻塞 event loop),是 session/列表页卡顿的真根因;worker 池化后单 query 降到 ~0.02s。代价:per-query 延迟仍是 MySQL RTT,worker 串行化 query(主线程 `Atomics.wait` 阻塞),所以 handler 里要避免 N+1——批量,或接受串行成本。`mysql_child.mjs` 是 spawn-per-query 旧路径,仅作 fallback(`MAPLE_MYSQL_FORCE_HELPER=true`)。
