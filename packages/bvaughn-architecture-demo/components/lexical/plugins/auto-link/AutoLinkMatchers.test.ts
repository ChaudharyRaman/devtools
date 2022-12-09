import MATCHERS_ARRAY, {
  EmailUrlMatcher,
  GenericUrlMatcher,
  GitHubUrlMatcher,
  ReplayUrlMatcher,
} from "./AutoLinkMatchers";
import { LinkMatch } from "./AutoLinkPlugin";

const SUFFIX_AND_PREFIX = [
  ["before ", ""],
  ["before ", " after"],
  ["", " after"],
  ["", ","],
  ["", "!"],
];

function test(
  rawText: string,
  matcher: (text: string) => LinkMatch | null,
  verify: (match: LinkMatch | null, text: string) => void
) {
  SUFFIX_AND_PREFIX.forEach(([before, after]) => {
    const text = `${before}${rawText}${after}`;
    const match = matcher(text);
    verify(match, rawText);
  });
}

function testAll(
  texts: string[],
  matcher: (text: string) => LinkMatch | null,
  verify: (match: LinkMatch | null, text: string) => void
) {
  texts.forEach(text => {
    test(text, matcher, verify);
  });
}

describe("AutoLinkMatchers", () => {
  it("give priority to Replay urls over generic urls", () => {
    const matcher = MATCHERS_ARRAY.find(matchFunction =>
      matchFunction(
        "before https://app.replay.io/recording/test-title--11111111-2222-3333-4444-555555555555 after"
      )
    );
    expect(matcher).toBe(ReplayUrlMatcher);
  });

  it("give priority to GitHub link urls over generic urls", () => {
    const matcher = MATCHERS_ARRAY.find(matchFunction =>
      matchFunction("before https://www.github.com/foo/bar/issues/123 after")
    );
    expect(matcher).toBe(GitHubUrlMatcher);
  });

  describe("EmailUrlMatcher", () => {
    it("should match generic emails", () => {
      testAll(
        [
          "bvaughn@replay.io",
          "brian.david.vaughn@gmail.com",
          "brian@subdomain.topleveldomain.com",
          "brian_vaughn@subdomain.topleveldomain.com",
        ],
        EmailUrlMatcher,
        (match, text) => {
          expect(match).not.toBeNull();
          expect(match!.formattedText).toBeNull();
          expect(match!.url).toBe(`mailto:${text}`);
        }
      );
    });

    it("should not match non url emails", () => {
      testAll(
        ["foo bar", "google.com", "brian@replay", "@brian", "@brian.vaughn"],
        EmailUrlMatcher,
        match => {
          expect(match).toBeNull();
        }
      );
    });
  });

  describe("GenericUrlMatcher", () => {
    it("should match generic urls", () => {
      testAll(
        [
          "https://www.google.com",
          "https://google.com",
          "http://www.google.com",
          "http://google.com",
          "www.google.com",
          "www.google.com/search?q=test",
          "https://en.wikipedia.org/wiki/New_York_City",
          "https://portal.311.nyc.gov/",
        ],
        GenericUrlMatcher,
        (match, text) => {
          expect(match).not.toBeNull();
          expect(match!.formattedText).toBeNull();
          expect(match!.url).toBe(text.startsWith("http") ? text : `https://${text}`);
        }
      );
    });

    it("should not match ambiguous urls", () => {
      testAll(["en.wikipedia.org/wiki/New_York_City"], GenericUrlMatcher, match => {
        expect(match).toBeNull();
      });
    });

    it("should not match non url text", () => {
      testAll(["foo bar", "google.com"], GenericUrlMatcher, match => {
        expect(match).toBeNull();
      });
    });
  });

  describe("GitHubUrlMatcher", () => {
    it("should match GitHub issue link", () => {
      testAll(
        [
          "https://www.github.com/foo/bar/issues/123",
          "https://github.com/foo/bar/issues/123",
          "www.github.com/foo/bar/issues/123",
          "github.com/foo/bar/issues/123",
          "github.com/foo/bar/issues/123?foo=bar",
        ],
        GitHubUrlMatcher,
        (match, text) => {
          expect(match).not.toBeNull();
          expect(match!.formattedText).toBe("#123 (foo/bar)");
          expect(match!.url).toBe(text.startsWith("http") ? text : `https://${text}`);
        }
      );
    });

    it("should match GitHub PR link", () => {
      testAll(
        [
          "https://www.github.com/foo/bar/pull/123",
          "https://github.com/foo/bar/pull/123",
          "www.github.com/foo/bar/pull/123",
          "github.com/foo/bar/pull/123",
          "github.com/foo/bar/pull/123/files",
          "github.com/foo/bar/pull/123/files?w=1",
        ],
        GitHubUrlMatcher,
        (match, text) => {
          expect(match).not.toBeNull();
          expect(match!.formattedText).toBe("#123 (foo/bar)");
          expect(match!.url).toBe(text.startsWith("http") ? text : `https://${text}`);
        }
      );
    });

    it("should not match other GitHub link", () => {
      testAll(
        ["https://www.github.com", "https://www.github.com/foo", "https://www.github.com/foo/bar"],
        GitHubUrlMatcher,
        match => {
          expect(match).toBeNull();
        }
      );
    });
  });

  describe("ReplayUrlMatcher", () => {
    it("should match Replay recording link", () => {
      testAll(
        [
          "https://app.replay.io/recording/test-title--11111111-2222-3333-4444-555555555555",
          "https://app.replay.io/recording/test-title--11111111-2222-3333-4444-555555555555?point=1234567890",
          "app.replay.io/recording/test-title--11111111-2222-3333-4444-555555555555",
          "app.replay.io/recording/test-title--11111111-2222-3333-4444-555555555555?point=1234567890",
        ],
        ReplayUrlMatcher,
        (match, text) => {
          expect(match).not.toBeNull();
          expect(match!.formattedText).toBe("Replay: test title");
          expect(match!.url).toBe(text.startsWith("http") ? text : `https://${text}`);
        }
      );
    });

    it("should not match other Replay link", () => {
      testAll(
        [
          "https://app.replay.io/",
          "https://app.replay.io/team/me/recordings",
          "app.replay.io",
          "app.replay.io/team/me/recordings",
        ],
        ReplayUrlMatcher,
        match => {
          expect(match).toBeNull();
        }
      );
    });
  });
});
