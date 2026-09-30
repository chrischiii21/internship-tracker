// Philippine banks and e-wallets the salary allocator recognises by account name, so "BPI Savings"
// or "BDO Visa" shows that bank's logo and brand color instead of a generic chip. Logos are each
// institution's official app icon, bundled at public/banks/<id>.png; colors are sampled from them.
// Anything unlisted falls back to a neutral monogram.
export interface Institution {
  id: string;
  name: string;
  color: string;
  type: 'bank' | 'ewallet';
  aliases: string[]; // matched as whole words, lowercase
}

export const INSTITUTIONS: Institution[] = [
  { id: 'bpi', name: 'BPI', color: '#E43C3C', type: 'bank', aliases: ['bpi', 'bank of the philippine islands'] },
  { id: 'bdo', name: 'BDO', color: '#0048A8', type: 'bank', aliases: ['bdo', 'banco de oro'] },
  { id: 'metrobank', name: 'Metrobank', color: '#5B45A8', type: 'bank', aliases: ['metrobank', 'metro bank', 'mbtc'] },
  { id: 'unionbank', name: 'UnionBank', color: '#F47A00', type: 'bank', aliases: ['unionbank', 'union bank', 'ubp'] },
  { id: 'securitybank', name: 'Security Bank', color: '#1FA6DC', type: 'bank', aliases: ['security bank', 'securitybank'] },
  { id: 'rcbc', name: 'RCBC', color: '#0C78CC', type: 'bank', aliases: ['rcbc'] },
  { id: 'landbank', name: 'Landbank', color: '#0C9A48', type: 'bank', aliases: ['landbank', 'land bank', 'lbp'] },
  { id: 'pnb', name: 'PNB', color: '#0C3078', type: 'bank', aliases: ['pnb', 'philippine national bank'] },
  { id: 'chinabank', name: 'China Bank', color: '#E3000F', type: 'bank', aliases: ['china bank', 'chinabank', 'cbc'] },
  { id: 'eastwest', name: 'EastWest', color: '#5F1A86', type: 'bank', aliases: ['eastwest', 'east west', 'ewb'] },
  { id: 'psbank', name: 'PSBank', color: '#D52B1E', type: 'bank', aliases: ['psbank', 'ps bank'] },
  { id: 'aub', name: 'AUB', color: '#E41824', type: 'bank', aliases: ['aub', 'asia united bank'] },
  { id: 'cimb', name: 'CIMB', color: '#E00000', type: 'bank', aliases: ['cimb'] },
  { id: 'hsbc', name: 'HSBC', color: '#DB0011', type: 'bank', aliases: ['hsbc'] },
  { id: 'gotyme', name: 'GoTyme', color: '#00C8DC', type: 'bank', aliases: ['gotyme', 'go tyme'] },
  { id: 'tonik', name: 'Tonik', color: '#7854FC', type: 'bank', aliases: ['tonik'] },
  { id: 'maribank', name: 'MariBank (SeaBank)', color: '#E45400', type: 'bank', aliases: ['maribank', 'mari bank', 'seabank', 'sea bank'] },
  { id: 'gcash', name: 'GCash', color: '#0A6CF0', type: 'ewallet', aliases: ['gcash', 'g-cash', 'gsave'] },
  { id: 'maya', name: 'Maya', color: '#2EE59D', type: 'ewallet', aliases: ['maya', 'paymaya'] },
  { id: 'shopeepay', name: 'ShopeePay', color: '#EE4D2D', type: 'ewallet', aliases: ['shopeepay', 'shopee pay', 'shopee'] },
  { id: 'grabpay', name: 'GrabPay', color: '#00B14F', type: 'ewallet', aliases: ['grabpay', 'grab pay', 'grab'] },
  { id: 'coins', name: 'Coins.ph', color: '#786CFC', type: 'ewallet', aliases: ['coins.ph', 'coins ph', 'coins'] },
];
