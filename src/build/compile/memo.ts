/* A `$` expression a render evaluated, with the data it was evaluated against and what it gave */
type Read = { expr: string; data: Record<string, unknown>; value: unknown };

/* What rendering one fragment produced: its HTML, the assets its components added (in order) and the `$` reads it depended on */
type Recording = { html: string | undefined; assets: Record<string, string>[]; reads: Read[] };

/*
 * How many recordings are kept per fragment and place. Each differs in what its `$` reads gave, so a fragment that shows the
 * page's own title gets one per page: past this it isn't worth keeping (and checking) them all.
 */
const MAX_RECORDINGS = 4;

/**
 * Remembers what rendering a fragment produced, so another page of the same build that renders the same fragment at the same
 * place reuses it instead of rendering again (a site's navigation and footer, rendered once instead of once per page).
 *
 * A fragment is "the same" when it's the same object, which `resolver` guarantees for every document a build reaches, and
 * "at the same place" when the _types it's nested in (`ancestors`) match, since those pick its components (see `lookup`).
 * Its fields can't differ, but `$` can: the page being rendered. So every expression reading `$` is recorded while a fragment
 * renders, nested renders included, and a recording is reused only when each of them still gives the same value.
 *
 * Rendering is synchronous, so recordings nest like the renders they record (see `run`).
 * @example const memo = new Memo(); render(home, components, parse, { memo }); render(about, components, parse, { memo }) // the footer renders once
 */
export class Memo {
  private recordings = new WeakMap<object, Map<string, Recording[]>>();
  /* The recordings of the renders running right now, innermost last */
  private open: Recording[] = [];

  /**
   * Renders `fragment` through `draw`, or reuses a recording whose `$` reads all give the same value again (checked with `check`).
   * Either way, what it read and added is passed on to the render around it, so that one depends on it too.
   * @param check Evaluates a recorded `$` expression for the page being rendered now.
   * @example memo.run(fragment, ancestors, (read) => evaluate(read.expr, read.data, page), () => draw(fragment))
   */
  run(fragment: object, ancestors: string[], check: (read: Read) => unknown, draw: () => string | undefined): { html: string | undefined; assets: Record<string, string>[] } {
    const key = ancestors.join("\u0000");
    const list = this.recordings.get(fragment)?.get(key) ?? [];
    const found = list.find((r) => r.reads.every((read) => Object.is(check(read), read.value)));
    if (found) {
      this.pass(found);
      return found;
    }

    const recording: Recording = { html: undefined, assets: [], reads: [] };
    this.open.push(recording);
    try {
      recording.html = draw();
    } finally {
      this.open.pop();
    }
    this.pass(recording);
    if (list.length < MAX_RECORDINGS) {
      const byKey = this.recordings.get(fragment) ?? new Map<string, Recording[]>();
      byKey.set(key, [...list, recording]);
      this.recordings.set(fragment, byKey);
    }
    return recording;
  }

  /**
   * Records a `$` expression evaluated by the render running now (a no-op outside one).
   * @example memo.read({ expr: "$.title", data, value: "Home" })
   */
  read(read: Read): void {
    this.open.at(-1)?.reads.push(read);
  }

  /**
   * Records assets added by the render running now (a no-op outside one).
   * @example memo.add({ "/_styles/a1b2.css": "h1 {}" })
   */
  add(assets: Record<string, string>): void {
    this.open.at(-1)?.assets.push(assets);
  }

  /* Hands what a finished or reused render read and added to the render around it */
  private pass(recording: Recording): void {
    const outer = this.open.at(-1);
    outer?.reads.push(...recording.reads);
    outer?.assets.push(...recording.assets);
  }
}
