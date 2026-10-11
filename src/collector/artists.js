// Verified from each official release page (Release island groupSlug / selectedGroupIds), 2026-10-11.
// artist_id is null until the group has a row in data/artists.csv.
// Without firstReleaseYear, use all years advertised by the official feed.
// Source group membership does not establish the identity of old names or related units.
export const artists = {
  morningmusume: {
    slug: "morningmusume",
    artistId: null,
    artistName: "モーニング娘。",
    officialGroupId: 3,
    releaseUrl: "https://helloproject.com/morningmusume/release/?pc=1"
  },
  angerme: {
    slug: "angerme",
    artistId: null,
    artistName: "アンジュルム",
    officialGroupId: 29,
    releaseUrl: "https://helloproject.com/angerme/release/?pc=1"
  },
  juicejuice: {
    slug: "juicejuice",
    artistId: "G00001",
    artistName: "Juice=Juice",
    officialGroupId: 36,
    releaseUrl: "https://helloproject.com/juicejuice/release/?pc=1"
  },
  tsubakifactory: {
    slug: "tsubakifactory",
    artistId: null,
    artistName: "つばきファクトリー",
    officialGroupId: 477,
    releaseUrl: "https://helloproject.com/tsubakifactory/release/?pc=1"
  },
  beyooooonds: {
    slug: "beyooooonds",
    artistId: null,
    artistName: "BEYOOOOONDS",
    officialGroupId: 585,
    releaseUrl: "https://helloproject.com/beyooooonds/release/?pc=1"
  },
  ochanorma: {
    slug: "ochanorma",
    artistId: null,
    artistName: "OCHA NORMA",
    officialGroupId: 634,
    releaseUrl: "https://helloproject.com/ochanorma/release/?pc=1"
  },
  rosychronicle: {
    slug: "rosychronicle",
    artistId: null,
    artistName: "ロージークロニクル",
    officialGroupId: 676,
    firstReleaseYear: 2025,
    releaseUrl: "https://helloproject.com/rosychronicle/release/?pc=1"
  }
};
