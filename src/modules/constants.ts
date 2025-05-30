export const APP_STORE_LINKS = {
  googlePlay: 'https://play.google.com/store/apps/details?id=app.readaloudai',
  appleAppStore: 'https://apps.apple.com/app/id6743985203',
};

export const DIMENSION_ESTIMATES = {
  PLAYER_WIDTH: 270,
  PLAYER_HEIGHT: 170,
  QUEUE_WIDTH: 340,
  QUEUE_HEIGHT: 400,

  RIGHT_MARGIN: 20,
  BOTTOM_MARGIN: 20,
}

// Absolute maximum limits for MP3 generation (non-configurable by user)
export const MP3_GENERATION_LIMITS = {
  MAX_WORDS: 5000,
  MAX_CHARACTERS: 30000,
} as const;