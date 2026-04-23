// Each progression uses 0-based diatonic degree indices (0 = I/i, 3 = IV/iv, etc.)

export const MAJOR_PROGRESSIONS = [
  { name: 'I – IV – V',              degrees: [0, 3, 4],       genre: 'Blues / Folk' },
  { name: 'I – IV – V – I',          degrees: [0, 3, 4, 0],    genre: 'Classic' },
  { name: 'I – V – vi – IV',         degrees: [0, 4, 5, 3],    genre: 'Pop' },
  { name: 'I – vi – IV – V',         degrees: [0, 5, 3, 4],    genre: '50s' },
  { name: 'I – vi – ii – V',         degrees: [0, 5, 1, 4],    genre: 'Jazz' },
  { name: 'ii – V – I',              degrees: [1, 4, 0],       genre: 'Jazz turnaround' },
  { name: 'I – IV – vi – V',         degrees: [0, 3, 5, 4],    genre: 'Pop variant' },
  { name: 'vi – IV – I – V',         degrees: [5, 3, 0, 4],    genre: 'Emotional pop' },
  { name: 'I – iii – IV – V',        degrees: [0, 2, 3, 4],    genre: 'Classic rock' },
  { name: 'I – V – vi – iii – IV',   degrees: [0, 4, 5, 2, 3], genre: 'Canon' },
  { name: 'I – ii – IV – I',         degrees: [0, 1, 3, 0],    genre: 'Folk' },
  { name: 'IV – I – V – vi',         degrees: [3, 0, 4, 5],    genre: 'Pop rotation' },
  { name: 'I – IV – I – V',          degrees: [0, 3, 0, 4],    genre: 'Blues loop' },
  { name: 'I – iii – vi – IV',       degrees: [0, 2, 5, 3],    genre: 'Sensitive' },
];

export const MINOR_PROGRESSIONS = [
  { name: 'i – VII – VI – VII',      degrees: [0, 6, 5, 6],    genre: 'Rock' },
  { name: 'i – iv – v',              degrees: [0, 3, 4],       genre: 'Minor blues' },
  { name: 'i – VI – III – VII',      degrees: [0, 5, 2, 6],    genre: 'Minor pop' },
  { name: 'i – iv – VII – III',      degrees: [0, 3, 6, 2],    genre: 'Andalusian' },
  { name: 'i – VII – VI – v',        degrees: [0, 6, 5, 4],    genre: 'Descending' },
  { name: 'i – III – VII – VI',      degrees: [0, 2, 6, 5],    genre: 'Metal / Rock' },
  { name: 'ii° – v – i',             degrees: [1, 4, 0],       genre: 'Minor jazz' },
  { name: 'i – VI – VII – i',        degrees: [0, 5, 6, 0],    genre: 'Minor loop' },
  { name: 'i – iv – i – v',          degrees: [0, 3, 0, 4],    genre: 'Folk minor' },
  { name: 'VI – VII – i',            degrees: [5, 6, 0],       genre: 'Modal minor' },
  { name: 'i – v – VI – VII',        degrees: [0, 4, 5, 6],    genre: 'Ascending minor' },
  { name: 'i – VI – III – v',        degrees: [0, 5, 2, 4],    genre: 'Ballad' },
];
