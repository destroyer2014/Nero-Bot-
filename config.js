export default {
  botName: 'Nero Bot',
  subbotBrand: 'NERO',
  creator: 'ArcadiaCorps',
  plugins: '60+',
  website: 'https://arcadiacorps.online/web-v2/login.html',
  serverLabel: process.env.NERO_SERVER_LABEL || 'Nero VPS',
  version: '1.18.8',
  prefix: '.',
  timezone: 'America/Lima',
  sessionName: 'principal',
  instanceType: 'principal', // "principal" o "subbot"

  ownerNumbers: ['51917611323'],
  // JID LID observado para el owner. Puede ampliarse con OWNER_LIDS en .env.
  ownerLids: ['50148205949148'],
  subOwnerNumbers: ['51921909260'],
  // JID LID conocido para subowners, mismo mecanismo que ownerLids.
  // Se puede ampliar con SUBOWNER_LIDS en .env (separados por coma).
  // Si no sabes el LID de un subowner, déjalo así: en cuanto el bot logre
  // resolver su número una sola vez (por lidMapping o metadata de grupo),
  // queda cacheado en sessions/lid-cache.json y ya no hace falta el override.
  subOwnerLids: ['238722939379788'],

  menuVideo: './assets/nero-menu.mp4',
  apiBaseUrl: process.env.DVYER_API_BASE_URL || 'https://dv-yer-api.online',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 90 * 1024 * 1024),
  searchLimit: Number(process.env.SEARCH_LIMIT || 5)
}
