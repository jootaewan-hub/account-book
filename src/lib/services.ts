// 구독 서비스 로고. 로고 모양은 Simple Icons(CC0, 상표는 각 회사 것)를 쓰고,
// Simple Icons에 없는 서비스(티빙·웨이브·쿠팡 등)는 브랜드 색 바탕에 이름을 그린다. 브랜드 색은 근사값이다.
import {
  si1password, siApple, siAppletv, siApplemusic, siBitwarden, siClaude, siCrunchyroll, siCursor, siDiscord, siDropbox,
  siDuolingo, siEvernote, siExpressvpn, siFigma, siGithubcopilot, siGoogle, siGoogledrive, siGooglegemini, siGrammarly,
  siHbomax, siIcloud, siKakao, siKakaotalk, siMega, siNaver, siNetflix, siNordvpn, siNotion, siParamountplus, siPerplexity,
  siPlaystation, siSoundcloud, siSpotify, siTidal, siTodoist, siTwitch, siWebtoon, siX, siYoutube, siYoutubemusic, siZoom,
  type SimpleIcon,
} from 'simple-icons'

export interface Service {
  name: string
  /** 비교용 이름들 (띄어쓰기 없이 소문자) */
  aliases: string[]
  color: string
  icon?: SimpleIcon
  /** 로고 모양이 없을 때 그릴 글자 */
  text?: string
}

const icon = (name: string, aliases: string[], i: SimpleIcon): Service => ({ name, aliases, color: `#${i.hex}`, icon: i })
const tile = (name: string, aliases: string[], color: string, text: string): Service => ({ name, aliases, color, text })

export const SERVICES: Service[] = [
  icon('넷플릭스', ['넷플릭스', 'netflix'], siNetflix),
  icon('유튜브 뮤직', ['유튜브뮤직', 'youtubemusic'], siYoutubemusic),
  icon('유튜브 프리미엄', ['유튜브프리미엄', 'youtubepremium', '유튜브', 'youtube'], siYoutube),
  icon('스포티파이', ['스포티파이', 'spotify'], siSpotify),
  icon('애플 뮤직', ['애플뮤직', 'applemusic'], siApplemusic),
  icon('애플 TV+', ['애플tv', 'appletv'], siAppletv),
  icon('아이클라우드+', ['아이클라우드', 'icloud'], siIcloud),
  icon('애플 원', ['애플원', 'appleone'], siApple),
  icon('구글 원', ['구글원', 'googleone'], siGoogle),
  icon('구글 드라이브', ['구글드라이브', 'googledrive'], siGoogledrive),
  icon('제미나이', ['제미나이', 'gemini'], siGooglegemini),
  icon('네이버 웹툰', ['네이버웹툰', '웹툰', 'webtoon'], siWebtoon),
  icon('네이버플러스 멤버십', ['네이버플러스', '네이버멤버십', 'naverplus', '네이버'], siNaver),
  icon('카카오톡 톡서랍', ['톡서랍', '카카오톡', 'kakaotalk'], siKakaotalk),
  icon('카카오', ['카카오', 'kakao'], siKakao),
  icon('Claude', ['claude', '클로드'], siClaude),
  icon('퍼플렉시티', ['퍼플렉시티', 'perplexity'], siPerplexity),
  icon('GitHub Copilot', ['githubcopilot', '코파일럿', 'copilot'], siGithubcopilot),
  icon('Cursor', ['cursor'], siCursor),
  icon('노션', ['노션', 'notion'], siNotion),
  icon('드롭박스', ['드롭박스', 'dropbox'], siDropbox),
  icon('듀오링고', ['듀오링고', 'duolingo'], siDuolingo),
  icon('플레이스테이션 플러스', ['플레이스테이션', 'playstation', 'ps플러스', 'psplus'], siPlaystation),
  icon('디스코드 니트로', ['디스코드', 'discord', '니트로'], siDiscord),
  icon('트위치', ['트위치', 'twitch'], siTwitch),
  icon('1Password', ['1password', '원패스워드'], si1password),
  icon('비트워든', ['비트워든', 'bitwarden'], siBitwarden),
  icon('NordVPN', ['nordvpn', '노드vpn'], siNordvpn),
  icon('ExpressVPN', ['expressvpn', '익스프레스vpn'], siExpressvpn),
  icon('크런치롤', ['크런치롤', 'crunchyroll'], siCrunchyroll),
  icon('타이달', ['타이달', 'tidal'], siTidal),
  icon('사운드클라우드', ['사운드클라우드', 'soundcloud'], siSoundcloud),
  icon('Zoom', ['zoom'], siZoom),
  icon('그래머리', ['그래머리', 'grammarly'], siGrammarly),
  icon('에버노트', ['에버노트', 'evernote'], siEvernote),
  icon('투두이스트', ['투두이스트', 'todoist'], siTodoist),
  icon('피그마', ['피그마', 'figma'], siFigma),
  icon('MEGA', ['mega.nz', 'mega클라우드'], siMega),
  icon('HBO Max', ['hbomax', 'hbo맥스'], siHbomax),
  icon('파라마운트+', ['파라마운트', 'paramount'], siParamountplus),
  icon('X 프리미엄', ['x프리미엄', '트위터', 'twitter'], siX),
  tile('티빙', ['티빙', 'tving'], '#ff153c', 'TVING'),
  tile('웨이브', ['웨이브', 'wavve'], '#1351f9', 'wavve'),
  tile('왓챠', ['왓챠', 'watcha'], '#ff0558', '왓챠'),
  tile('쿠팡플레이', ['쿠팡플레이', 'coupangplay'], '#1a1a1a', '쿠플'),
  tile('쿠팡 와우', ['쿠팡와우', '와우멤버십', '로켓와우', '쿠팡', 'coupang'], '#e52528', 'WOW'),
  tile('디즈니+', ['디즈니', 'disney'], '#0c1d5c', 'D+'),
  tile('멜론', ['멜론', 'melon'], '#00cd3c', 'melon'),
  tile('지니뮤직', ['지니뮤직', 'genie'], '#00a2ff', 'genie'),
  tile('벅스', ['벅스', 'bugs'], '#ff3c28', 'bugs'),
  tile('FLO', ['플로', 'flomusic'], '#3f3fff', 'FLO'),
  tile('ChatGPT', ['chatgpt', '챗gpt', '챗지피티', 'openai'], '#10a37f', 'GPT'),
  tile('마이크로소프트 365', ['microsoft365', '마이크로소프트', 'ms365', '오피스365', 'office365'], '#d83b01', 'M365'),
  tile('어도비', ['adobe', '어도비', '포토샵', 'photoshop', '라이트룸', 'lightroom'], '#fa0f00', 'Ad'),
  tile('배민클럽', ['배민클럽', '배민', '배달의민족'], '#2ac1bc', '배민'),
  tile('요기패스', ['요기패스', '요기요'], '#fa0050', '요기요'),
  tile('밀리의 서재', ['밀리의서재', '밀리'], '#ffd400', '밀리'),
  tile('리디', ['리디', 'ridi'], '#1f8ce6', 'RIDI'),
  tile('라프텔', ['라프텔', 'laftel'], '#816bff', '라프텔'),
  tile('아마존 프라임', ['아마존프라임', 'amazonprime', '프라임비디오', 'primevideo'], '#00a8e1', 'prime'),
  tile('닌텐도 스위치 온라인', ['닌텐도', 'nintendo'], '#e60012', 'N'),
  tile('엑스박스 게임 패스', ['xbox', '엑스박스', '게임패스', 'gamepass'], '#107c10', 'XBOX'),
  tile('컬리멤버스', ['컬리멤버스', '컬리', 'kurly'], '#5f0080', 'Kurly'),
]

/** 구독 추가 화면의 빠른 선택 */
export const POPULAR = ['넷플릭스', '유튜브 프리미엄', '쿠팡 와우', '네이버플러스 멤버십', '티빙', '디즈니+', '웨이브', '쿠팡플레이',
  '왓챠', '멜론', '스포티파이', 'ChatGPT', 'Claude', '아이클라우드+', '배민클럽']
  .map((n) => SERVICES.find((s) => s.name === n)!)

const ALIASES = SERVICES.flatMap((s) => s.aliases.map((a) => [a, s] as const)).sort((a, b) => b[0].length - a[0].length)

/** 이름으로 구독 서비스를 찾는다. 긴 이름을 먼저 맞춘다 (유튜브 뮤직 ≠ 유튜브) */
export function serviceOf(name: string | null | undefined): Service | null {
  const t = (name ?? '').replace(/\s+/g, '').toLowerCase()
  if (!t) return null
  return ALIASES.find(([a]) => t.includes(a))?.[1] ?? null
}

/** 바탕색 위에 읽히는 글자색 (WCAG 상대 휘도 기준) */
export function inkOn(hex: string): '#ffffff' | '#111111' {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
  // 흰 글자와 검은 글자 중 대비가 더 큰 쪽
  return (1.05 / (l + 0.05)) >= ((l + 0.05) / 0.05) ? '#ffffff' : '#111111'
}
