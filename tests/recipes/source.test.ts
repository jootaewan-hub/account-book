import { describe, expect, it } from 'vitest'
import { normalizeRecipeUrl } from '../../supabase/functions/_shared/recipeSource.ts'

describe('레시피 주소 정규화', () => {
  it.each([
    'https://youtu.be/AkX6uA4BaDs?si=x',
    'https://m.youtube.com/watch?v=AkX6uA4BaDs&t=30s',
    'https://www.youtube.com/watch?feature=share&v=AkX6uA4BaDs',
    '  www.youtube.com/watch?v=AkX6uA4BaDs  ',
    'https://music.youtube.com/watch?v=AkX6uA4BaDs',
    'https://www.youtube.com/live/AkX6uA4BaDs',
    'https://www.youtube.com/embed/AkX6uA4BaDs',
  ])('%s 은 같은 열쇠', (input) => {
    expect(normalizeRecipeUrl(input)).toEqual({
      kind: 'youtube',
      key: 'youtube:AkX6uA4BaDs',
      url: 'https://www.youtube.com/watch?v=AkX6uA4BaDs',
    })
  })

  it('쇼츠', () => {
    expect(normalizeRecipeUrl('https://youtube.com/shorts/wruh__UmGaU/?feature=share')).toEqual({
      kind: 'youtube_shorts',
      key: 'youtube:wruh__UmGaU',
      url: 'https://www.youtube.com/shorts/wruh__UmGaU',
    })
  })

  it.each([
    'https://www.youtube.com/playlist?list=PL1',
    'https://www.youtube.com/playlist?list=PLabcdefghijk',
    'https://www.youtube.com/watch?list=PLabcdefghijk',
    'https://www.instagram.com/reel/abc',
    'https://example.com/watch?v=AkX6uA4BaDs',
    'https://evilyoutube.com/watch?v=AkX6uA4BaDs',
    'youtube.com/watch?v=short',
    '',
  ])('%s 은 null', (input) => {
    expect(normalizeRecipeUrl(input)).toBeNull()
  })
})
