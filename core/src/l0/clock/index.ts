// `clock` — L0, única fonte de "agora" injetável (§4, §1.5).
//
// §4: não pode ser lido pelo fold (o fold usa hostTs do registro).

export class SystemClock {
  now(): number {
    return Date.now();
  }
}

export class FixedClock {
  #time: number;
  constructor(initial: number = Date.now()) {
    this.#time = initial;
  }
  now(): number {
    return this.#time;
  }
  set(time: number): void {
    this.#time = time;
  }
  advance(ms: number): void {
    this.#time += ms;
  }
}
