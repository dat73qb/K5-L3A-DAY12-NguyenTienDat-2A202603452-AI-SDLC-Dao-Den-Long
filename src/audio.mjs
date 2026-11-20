const effects = {
  mote_picked: [660, 880], charm_picked: [523, 659, 784, 1047], lantern_lit: [392, 523, 659, 784],
  pulse: [330, 250, 160], player_hit: [145, 110], jump_sound: [330, 490], dash: [210, 390],
  won: [523, 659, 784, 1047], lost: [370, 294, 196], shade_spawned: [118, 93],
  countdown: [550], wind_warning: [270, 310, 240], drifter_steal: [307, 230], drifter_drop: [440, 659]
};

export function gameAudio(getVolume) {
  let audio, master, playing = false, next = 0, noteIndex = 0;
  const melody = [196, 294, 262, 392, 330, 262, 220, 294];
  function initialize() {
    if (!audio && window.AudioContext) {
      audio = new AudioContext();
      master = audio.createGain();
      master.connect(audio.destination);
    }
    if (audio?.state === 'suspended') audio.resume().catch(() => {});
    volume();
  }
  function volume() {
    if (audio) master.gain.value = getVolume() / 100;
  }
  function tone(hz, start, duration, strength, type = 'sine') {
    const oscillator = audio.createOscillator();
    const envelope = audio.createGain();
    oscillator.frequency.value = hz;
    oscillator.type = type;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(strength, start + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration);
  }
  return {
    initialize, volume,
    background(active) { playing = active; },
    update() {
      if (!audio || !playing || audio.state !== 'running' || audio.currentTime < next) return;
      tone(melody[noteIndex++ % melody.length], audio.currentTime, 0.68, 0.055);
      next = audio.currentTime + 0.61;
    },
    play(name) {
      if (!audio || audio.state !== 'running' || !effects[name]) return;
      effects[name].forEach((hz, i) => tone(hz, audio.currentTime + i * 0.085, 0.18, 0.12, 'triangle'));
    }
  };
}
