-- Generated from the supplied Excel workbook. Run after schema.sql.
insert into quiz_private.questions (id,text,options,seconds,correct)
select id,text,options,seconds,correct from jsonb_to_recordset($questions$[
  {
    "id": 0,
    "text": "¿Qué animal vive en las Galápagos?",
    "options": [
      "Monos",
      "Tortugas",
      "Tucanes",
      "Llamas"
    ],
    "seconds": 20,
    "correct": 1
  },
  {
    "id": 1,
    "text": "¿Entre qué países está el Titicaca?",
    "options": [
      "Perú y Bolivia",
      "Chile y Argentina",
      "Perú y Ecuador",
      "Argentina y Brasil"
    ],
    "seconds": 20,
    "correct": 0
  },
  {
    "id": 2,
    "text": "¿Qué hay en el suelo de Uyuni?",
    "options": [
      "Arena",
      "Nieve",
      "Hielo",
      "Sal"
    ],
    "seconds": 20,
    "correct": 3
  },
  {
    "id": 3,
    "text": "¿Qué paisaje rodea las cataratas del Iguazú?",
    "options": [
      "Desierto",
      "Salar",
      "Selva",
      "Cordillera"
    ],
    "seconds": 20,
    "correct": 2
  },
  {
    "id": 4,
    "text": "¿A dónde llega el río Amazonas?",
    "options": [
      "Al Pacífico",
      "Al lago Titicaca",
      "Al Atlántico",
      "Al mar Caribe"
    ],
    "seconds": 20,
    "correct": 2
  },
  {
    "id": 5,
    "text": "¿Qué son las Galápagos?",
    "options": [
      "Un lago",
      "Un desierto",
      "Una cordillera",
      "Un archipiélago"
    ],
    "seconds": 20,
    "correct": 3
  },
  {
    "id": 6,
    "text": "Según el texto, ¿qué puede pasar de noche en el Titicaca?",
    "options": [
      "Puede hacer calor",
      "Puede hacer frío",
      "Puede nevar",
      "Puede llover"
    ],
    "seconds": 20,
    "correct": 1
  },
  {
    "id": 7,
    "text": "¿Entre qué países están las cataratas del Iguazú?",
    "options": [
      "Perú y Brasil",
      "Chile y Argentina",
      "Perú y Bolivia",
      "Argentina y Brasil"
    ],
    "seconds": 20,
    "correct": 3
  },
  {
    "id": 8,
    "text": "¿En qué país está el Salar de Uyuni?",
    "options": [
      "Bolivia",
      "Chile",
      "Perú",
      "Ecuador"
    ],
    "seconds": 20,
    "correct": 0
  },
  {
    "id": 9,
    "text": "¿Por qué países pasa el río Amazonas?",
    "options": [
      "Chile y Argentina",
      "Perú y Brasil",
      "Ecuador y Chile",
      "Uruguay y Paraguay"
    ],
    "seconds": 20,
    "correct": 1
  }
]$questions$::jsonb)
as q(id integer,text text,options jsonb,seconds integer,correct integer)
on conflict(id) do update set text=excluded.text,options=excluded.options,seconds=excluded.seconds,correct=excluded.correct;
