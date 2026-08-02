export default {
  botName: 'Nero Bot',
  creator: 'ArcadiaCorps',
  plugins: '60+',
  website: 'https://arcadiacorps.online',
  version: '1.5.0',
  prefix: '.',
  timezone: 'America/Lima',
  sessionName: 'principal',
  instanceType: 'principal', // "principal" o "subbot"

  ownerNumbers: ['51917611323'],
  subOwnerNumbers: ['51921909260'],

  menuVideo: './assets/nero-menu.mp4',
  apiBaseUrl: process.env.DVYER_API_BASE_URL || 'https://dv-yer-api.online',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 90 * 1024 * 1024),
  searchLimit: Number(process.env.SEARCH_LIMIT || 5)
}
