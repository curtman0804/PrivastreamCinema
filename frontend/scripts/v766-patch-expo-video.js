const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

const tracksPath = path.join(
  root,
  'node_modules',
  'expo-video',
  'android',
  'src',
  'main',
  'java',
  'expo',
  'modules',
  'video',
  'records',
  'Tracks.kt'
);

if (!fs.existsSync(tracksPath)) {
  throw new Error(
    '[V766] expo-video Tracks.kt not found: ' + tracksPath
  );
}

let src = fs.readFileSync(tracksPath, 'utf8');

if (src.includes('V766_AUDIO_MIME_BRIDGE')) {
  console.log('[V766] expo-video audio MIME bridge already installed');
  process.exit(0);
}

const nl = src.includes('\r\n') ? '\r\n' : '\n';

const oldBlock = [
  'class AudioTrack(',
  '  @Field val id: String,',
  '  @Field val language: String?,',
  '  @Field val label: String?',
  ') : Record, Serializable {',
  '  companion object {',
  '    fun fromFormat(format: Format?): AudioTrack? {',
  '      format ?: return null',
  '      val id = format.id ?: return null',
  '      val language = format.language',
  '      val label = language?.let { Locale(it).displayLanguage } ?: "Unknown"',
  '',
  '      return AudioTrack(',
  '        id = id,',
  '        language = language,',
  '        label = label',
  '      )',
  '    }',
  '  }',
  '}'
].join(nl);

const newBlock = [
  '// V766_AUDIO_MIME_BRIDGE',
  '// Preserve Media3 sampleMimeType on AudioTrack records so JS can',
  '// make runtime decisions from the actual loaded media format.',
  'class AudioTrack(',
  '  @Field val id: String,',
  '  @Field val language: String?,',
  '  @Field val label: String?,',
  '  @Field val mimeType: String?',
  ') : Record, Serializable {',
  '  companion object {',
  '    fun fromFormat(format: Format?): AudioTrack? {',
  '      format ?: return null',
  '      val id = format.id ?: return null',
  '      val language = format.language',
  '      val label = language?.let { Locale(it).displayLanguage } ?: "Unknown"',
  '      val mimeType = format.sampleMimeType',
  '',
  '      return AudioTrack(',
  '        id = id,',
  '        language = language,',
  '        label = label,',
  '        mimeType = mimeType',
  '      )',
  '    }',
  '  }',
  '}'
].join(nl);

const pieces = src.split(oldBlock);
const count = pieces.length - 1;

if (count !== 1) {
  throw new Error(
    '[V766] expected exactly one pristine AudioTrack block; found ' +
      count
  );
}

src = pieces.join(newBlock);

fs.writeFileSync(tracksPath, src, 'utf8');

console.log('[V766] expo-video audio MIME bridge installed');
