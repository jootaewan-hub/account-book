// 이 프로젝트에서 더함(D-034 보충): 이 컴퓨터에서 같은 사이트를 gapMs보다 자주 부르지 않는다(robots Crawl-delay).
// 창 여러 개에서 함께 불러도 잠금 파일로 줄을 세운다. 마지막 호출 시각은 임시 폴더 k-skill-throttle/<사이트>.last
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function throttle(site, gapMs) {
  const dir = path.join(os.tmpdir(), "k-skill-throttle")
  fs.mkdirSync(dir, { recursive: true })
  const lock = path.join(dir, `${site}.lock`)
  const stamp = path.join(dir, `${site}.last`)
  for (;;) {
    try {
      fs.closeSync(fs.openSync(lock, "wx"))
      break
    } catch (error) {
      if (error.code !== "EEXIST") throw error
      // 앞 호출이 멈춰 남은 잠금(2분 넘음)은 지운다
      try {
        if (Date.now() - fs.statSync(lock).mtimeMs > 120_000) fs.rmSync(lock, { force: true })
      } catch {}
      await sleep(200)
    }
  }
  try {
    let last = 0
    try {
      last = Number(fs.readFileSync(stamp, "utf8")) || 0
    } catch {}
    const wait = last + gapMs - Date.now()
    if (wait > 0) {
      process.stderr.write(`${site}: robots 간격을 지키려고 ${Math.ceil(wait / 1000)}초 기다린다\n`)
      await sleep(wait)
    }
    fs.writeFileSync(stamp, String(Date.now()))
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

module.exports = { throttle }
