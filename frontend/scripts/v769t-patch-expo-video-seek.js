const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');

const packagePath = path.join(
  root,
  'node_modules',
  'expo-video',
  'package.json'
);

const modulePath = path.join(
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
  'VideoModule.kt'
);

function sha256(file) {
  return crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex')
    .toUpperCase();
}

if (!fs.existsSync(packagePath)) {
  throw new Error(
    '[V769T] expo-video package.json not found'
  );
}

if (!fs.existsSync(modulePath)) {
  throw new Error(
    '[V769T] VideoModule.kt not found'
  );
}

const pkg = JSON.parse(
  fs.readFileSync(packagePath, 'utf8')
);

if (pkg.version !== '3.0.16') {
  throw new Error(
    '[V769T] expected expo-video 3.0.16; found ' +
      pkg.version
  );
}

let src = fs.readFileSync(modulePath, 'utf8');

if (src.includes('V769T_TOLERANT_MANUAL_SEEK')) {
  console.log(
    '[V769T] tolerant manual seek already installed'
  );
  process.exit(0);
}

const pristineSha =
  'A7EA37604528F1E6955D5BD535B613AD479D6C59AD266BD66972EEDBAE6E7EC5';

const currentSha = sha256(modulePath);

if (currentSha !== pristineSha) {
  throw new Error(
    '[V769T] unexpected pristine VideoModule.kt SHA256=' +
      currentSha
  );
}

const nl = src.includes('\r\n') ? '\r\n' : '\n';

const oldImport =
  'import androidx.media3.common.util.UnstableApi';

const newImport = [
  'import androidx.media3.common.util.UnstableApi',
  'import androidx.media3.common.util.Util',
  'import androidx.media3.exoplayer.SeekParameters'
].join(nl);

const importParts = src.split(oldImport);

if (importParts.length - 1 !== 1) {
  throw new Error(
    '[V769T] expected one UnstableApi import'
  );
}

src = importParts.join(newImport);

const oldAnchor = [
  '      Function("pause") { ref: VideoPlayer ->',
  '        appContext.mainQueue.launch {',
  '          ref.player.pause()',
  '        }',
  '      }',
  '',
  '      Property("timeUpdateEventInterval")'
].join(nl);

const newAnchor = [
  '      Function("pause") { ref: VideoPlayer ->',
  '        appContext.mainQueue.launch {',
  '          ref.player.pause()',
  '        }',
  '      }',
  '',
  '      // V769T_TOLERANT_MANUAL_SEEK',
  '      // Manual FF/scrub may land on a nearby sync frame for fast recovery.',
  '      // Exact seeks continue to use currentTime.',
  '      Function("seekToWithTolerance") {',
  '        ref: VideoPlayer,',
  '        currentTime: Double,',
  '        toleranceBefore: Double,',
  '        toleranceAfter: Double ->',
  '        appContext.mainQueue.launch {',
  '          val beforeMs =',
  '            (toleranceBefore.coerceAtLeast(0.0) * 1000.0).toLong()',
  '          val afterMs =',
  '            (toleranceAfter.coerceAtLeast(0.0) * 1000.0).toLong()',
  '',
  '          ref.player.setSeekParameters(',
  '            SeekParameters(',
  '              Util.msToUs(beforeMs),',
  '              Util.msToUs(afterMs)',
  '            )',
  '          )',
  '',
  '          try {',
  '            ref.player.seekTo(',
  '              (currentTime * 1000.0).toLong()',
  '            )',
  '          } finally {',
  '            ref.player.setSeekParameters(',
  '              SeekParameters.EXACT',
  '            )',
  '          }',
  '        }',
  '      }',
  '',
  '      Property("timeUpdateEventInterval")'
].join(nl);

const anchorParts = src.split(oldAnchor);

if (anchorParts.length - 1 !== 1) {
  throw new Error(
    '[V769T] expected one pause/timeUpdate anchor'
  );
}

src = anchorParts.join(newAnchor);

fs.writeFileSync(
  modulePath,
  src,
  'utf8'
);

const verify = fs.readFileSync(
  modulePath,
  'utf8'
);

if (
  !verify.includes('V769T_TOLERANT_MANUAL_SEEK') ||
  !verify.includes('Function("seekToWithTolerance")') ||
  !verify.includes('SeekParameters.EXACT')
) {
  throw new Error(
    '[V769T] verification failed'
  );
}

console.log(
  '[V769T] expo-video tolerant manual seek installed'
);

console.log(
  '[V769T] VideoModule.kt SHA256=' +
    sha256(modulePath)
);