// The full address of a flat or house, as residents write it:
//   flat:  "101, 1 floor, E block, XYZ society, Plot 14 Vesu Main Road, Pune, Maharashtra, India - 411001"
//   house: "12, B section, Green Valley, Plot 14 Vesu Main Road, Pune, Maharashtra, India - 411001"
// Not stored: a unit keeps only its own parts (flat number, floor, block / house number, section) and the rest comes from the society
// and its city when the address is shown, so a rename or an address change never leaves stale copies. Build it with these helpers.

interface Place {
  society: string;
  /** The society's street address; left out when it has none. */
  address: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string | null;
}

// "E" -> "E block"; a name that already ends with the word ("E Block") is left alone.
const withWord = (name: string, word: 'block' | 'section'): string => (new RegExp(`(^|\\s)${word}$`, 'i').test(name) ? name : `${name} ${word}`);

// " - 411001" at the end, when the society has a pincode.
const withPincode = (address: string, pincode: string | null): string => (pincode ? `${address} - ${pincode}` : address);

export const flatAddress = (flat: { number: string; floor: number; building: string }, place: Place): string =>
  withPincode([flat.number, `${flat.floor} floor`, withWord(flat.building, 'block'), ...(place.address ? [place.society, place.address] : [place.society]), place.city, place.state, place.country].join(', '), place.pincode);

export const houseAddress = (house: { number: string; section: string }, place: Place): string =>
  withPincode([house.number, withWord(house.section, 'section'), ...(place.address ? [place.society, place.address] : [place.society]), place.city, place.state, place.country].join(', '), place.pincode);
