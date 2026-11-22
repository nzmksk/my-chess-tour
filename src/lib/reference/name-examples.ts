type NameExample = {
  onId: string;
  firstName: string;
  lastName: string;
};

type NameGroup = {
  heading: string;
  note: string;
  examples: NameExample[];
};

export const NAME_GROUPS: NameGroup[] = [
  {
    heading: "Malay names",
    note: "Your own name goes in First name. Bin or binti and your father's name go in Last name. Keep short forms such as Mohd or Abd as your IC writes them.",
    examples: [
      { onId: "AHMAD BIN ISMAIL", firstName: "Ahmad", lastName: "bin Ismail" },
      {
        onId: "NUR AISYAH BINTI ABDULLAH",
        firstName: "Nur Aisyah",
        lastName: "binti Abdullah",
      },
      {
        onId: "MOHD FAIZ BIN OSMAN",
        firstName: "Mohd Faiz",
        lastName: "bin Osman",
      },
    ],
  },
  {
    heading: "Chinese names",
    note: "Your IC puts your surname first. Put it in Last name and your given name in First name. If your IC also shows an English name, add it to First name.",
    examples: [
      { onId: "TAN WEI MING", firstName: "Wei Ming", lastName: "Tan" },
      { onId: "LIM MEI LING", firstName: "Mei Ling", lastName: "Lim" },
      {
        onId: "JASON WONG KAH HOE",
        firstName: "Jason Kah Hoe",
        lastName: "Wong",
      },
    ],
  },
  {
    heading: "Indian names",
    note: "Your own name goes in First name. A/l or a/p and your father's name go in Last name.",
    examples: [
      { onId: "MUTHU A/L RAJAN", firstName: "Muthu", lastName: "a/l Rajan" },
      {
        onId: "PRIYA A/P SUBRAMANIAM",
        firstName: "Priya",
        lastName: "a/p Subramaniam",
      },
      {
        onId: "HARJIT SINGH A/L GURDEV SINGH",
        firstName: "Harjit Singh",
        lastName: "a/l Gurdev Singh",
      },
    ],
  },
  {
    heading: "Other names",
    note: "If your name has a family name, it goes in Last name. If it has anak and your father's name instead, those go in Last name. On a passport, Given names go in First name and Surname in Last name.",
    examples: [
      { onId: "JIMMY ANAK JUGAH", firstName: "Jimmy", lastName: "anak Jugah" },
      {
        onId: "ROSALIND JUNIUS",
        firstName: "Rosalind",
        lastName: "Junius",
      },
      { onId: "SARAH D'CRUZ", firstName: "Sarah", lastName: "D'Cruz" },
      {
        onId: "NGUYEN VAN AN (passport)",
        firstName: "Van An",
        lastName: "Nguyen",
      },
    ],
  },
];
