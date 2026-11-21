/* =========================================================
   BOX BOX: team radio clips
   ---------------------------------------------------------
   To add a clip: put the .mp3 in the audio/ folder and add
   one line below. Nothing else needs to change.

   file      name of the file inside audio/
   label     text shown as the radio message
   category  when the clip plays:
               "hurry"    a sector, or the whole task, reaches 80% of its estimate
               "overtime" task goes over its total estimate
               "victory"  every task of the day is finished
   When a category has several clips, one is picked at random
   (never the same one twice in a row).
   ========================================================= */

const AUDIO_CLIPS = [
  { file: 'hammer-time.mp3',                label: "It's hammer time",                 category: 'hurry' },
  { file: 'box-box.mp3',                    label: 'Box box, box box',                 category: 'overtime' },
  { file: 'victory-verstappen-2021.mp3',    label: 'Verstappen – World Champion 2021', category: 'victory' },
  { file: 'victory-vettel-2010.mp3',        label: 'Vettel – World Champion 2010',     category: 'victory' },
  { file: 'victory-leclerc-monza-2019.mp3', label: 'Leclerc – Monza 2019',             category: 'victory' },
];
