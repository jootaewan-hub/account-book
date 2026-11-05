import birthday from '../assets/anniversaries/birthday.webp'
import couple from '../assets/anniversaries/couple.webp'
import memorial from '../assets/anniversaries/memorial.webp'
import { annivIconOf } from '../lib/anniversaries'
import type { Anniversary } from '../lib/types'
import { CalendarIcon, CoinsIcon, HeartbeatIcon, NoteIcon, StarIcon } from './Icons'

const photos = { birthday, couple, memorial }
const symbols = { calendar: CalendarIcon, money: CoinsIcon, hospital: HeartbeatIcon, document: NoteIcon, special: StarIcon }

export function AnnivIcon({ a }: { a: Pick<Anniversary, 'name' | 'category' | 'kind'> }) {
  const icon = annivIconOf(a)
  if (icon === 'birthday' || icon === 'couple' || icon === 'memorial') {
    return <img className="anniv-photo" src={photos[icon]} width={32} height={32} alt="" />
  }
  const Icon = symbols[icon]
  return <Icon />
}
