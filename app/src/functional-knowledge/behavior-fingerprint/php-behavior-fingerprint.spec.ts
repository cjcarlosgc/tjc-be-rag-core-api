import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { extractPhpBehaviorConstructs } from './php-behavior-fingerprint.js';

async function kindsOf(source: string, qualifiedName: string): Promise<string[]> {
  return (await extractPhpBehaviorConstructs(source, qualifiedName)).map(
    (construct) => construct.scenarioKind,
  );
}

async function hashesOf(source: string, qualifiedName: string): Promise<string[]> {
  return (await extractPhpBehaviorConstructs(source, qualifiedName)).map(
    (construct) => construct.formHash,
  );
}

describe('extractPhpBehaviorConstructs', () => {
  it('classifies if, elseif and else if branches by comparison', async () => {
    const source = `<?php
namespace App;
class Gate {
  public function open(int $level, bool $ok): bool {
    if ($ok) { return true; }
    if ($level < 3) { return false; }
    elseif ($level === 5) { return true; }
    else if ($level >= 10) { return true; }
    return false;
  }
}`;

    const constructs = await extractPhpBehaviorConstructs(source, 'App\\Gate.open');

    expect(constructs.map((item) => item.scenarioKind)).toEqual([
      'EXPECTED_RESULT',
      'BOUNDARY',
      'EXPECTED_RESULT',
      'BOUNDARY',
    ]);
    expect(constructs.map((item) => item.order)).toEqual([0, 1, 2, 3]);
    expect(constructs[0].snippet).toBe('if ($ok)');
    expect(constructs[2].snippet).toBe('elseif ($level === 5)');
  });

  it('classifies full ternaries and ignores the short ternary', async () => {
    const source = `<?php
namespace App;
class Pricing {
  public function pick(int $total, bool $flag): int {
    $label = $total > 10 ? $total : 0;
    $fallback = $flag ? 1 : 0;
    $name = $flag ?: 'none';
    return $label + $fallback;
  }
}`;

    expect(await kindsOf(source, 'App\\Pricing.pick')).toEqual(['BOUNDARY', 'EXPECTED_RESULT']);
  });

  it('classifies switch and match by the comparison in the discriminant', async () => {
    const source = `<?php
namespace App;
class Labels {
  public function label(int $code, int $score): string {
    switch ($code) { case 1: return 'a'; default: return 'b'; }
  }
  public function grade(int $score): string {
    return match ($score >= 90) { true => 'A', false => 'B' };
  }
}`;

    expect(await kindsOf(source, 'App\\Labels.label')).toEqual(['EXPECTED_RESULT']);
    expect(await kindsOf(source, 'App\\Labels.grade')).toEqual(['BOUNDARY']);
  });

  it('classifies throw expressions as EXCEPTION', async () => {
    const source = `<?php
namespace App;
class Guard {
  public function check(int $value): void {
    if ($value < 0) { throw new \\DomainException('negative'); }
  }
}`;

    const constructs = await extractPhpBehaviorConstructs(source, 'App\\Guard.check');

    expect(constructs.map((item) => item.scenarioKind)).toEqual(['BOUNDARY', 'EXCEPTION']);
  });

  it('detects state writes on members, static properties and subscripts, but not locals', async () => {
    const source = `<?php
namespace App;
class Counter {
  public function bump(int $step): void {
    $local = $step;
    $local += 1;
    $this->value = $local;
    $this->value += $step;
    self::$total++;
    static::$total = 3;
    $this->history[0] = $step;
    $list[0] = 1;
    $local--;
    $copy = $this->value;
  }
}`;

    const constructs = await extractPhpBehaviorConstructs(source, 'App\\Counter.bump');

    expect(constructs.map((item) => item.scenarioKind)).toEqual([
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
      'STATE_TRANSITION',
    ]);
    expect(constructs.map((item) => item.snippet)).toEqual([
      '$this->value = $local',
      '$this->value += $step',
      'self::$total++',
      'static::$total = 3',
      '$this->history[0] = $step',
    ]);
  });

  it('distinguishes prefix from postfix updates on state', async () => {
    const prefix = `<?php
namespace App;
class Counter { public function bump(): void { ++$this->value; } }`;
    const postfix = prefix.replace('++$this->value', '$this->value++');

    const prefixConstructs = await extractPhpBehaviorConstructs(prefix, 'App\\Counter.bump');
    const postfixConstructs = await extractPhpBehaviorConstructs(postfix, 'App\\Counter.bump');

    expect(prefixConstructs.map((item) => item.scenarioKind)).toEqual(['STATE_TRANSITION']);
    expect(postfixConstructs.map((item) => item.scenarioKind)).toEqual(['STATE_TRANSITION']);
    expect(prefixConstructs[0].formHash).not.toEqual(postfixConstructs[0].formHash);
  });

  it('does not count calls, null coalescing or short ternaries', async () => {
    const source = `<?php
namespace App;
class Totals {
  public function total(array $items): int {
    $sum = $this->compute($items) ?? 0;
    $value = $this->pick() ?: $this->fallback();
    return $this->sum($items) + ($this->limit ?? 1);
  }
}`;

    expect(await extractPhpBehaviorConstructs(source, 'App\\Totals.total')).toEqual([]);
  });

  it('keeps the fingerprint stable when a local variable of the body is renamed', async () => {
    const original = `<?php
namespace App;
class Pricer {
  public function price(int $amount): int {
    $discount = $amount > 100 ? 10 : 0;
    if ($discount > 5) { throw new \\RuntimeException('too big'); }
    return $amount - $discount;
  }
}`;
    const renamed = original.replace(/\$discount/g, '$reduction');

    expect(await hashesOf(renamed, 'App\\Pricer.price')).toEqual(
      await hashesOf(original, 'App\\Pricer.price'),
    );
  });

  it('changes the fingerprint when an own parameter is renamed, as in TypeScript', async () => {
    const original = `<?php
namespace App;
class Pricer {
  public function price(int $amount): int {
    if ($amount > 5) { return 1; }
    return 0;
  }
}`;
    const renamed = original.replace(/\$amount/g, '$value');

    expect(await hashesOf(renamed, 'App\\Pricer.price')).not.toEqual(
      await hashesOf(original, 'App\\Pricer.price'),
    );
  });

  it('normalizes parameters of nested closures and treats own parameters as non-state', async () => {
    const original = `<?php
namespace App;
class Items {
  public function run(array $items, int $limit): void {
    array_map(function ($item) { if ($item->x < 1) { return; } }, $items);
    $limit = 2;
  }
}`;
    const renamedClosure = original.replace(/\$item\b/g, '$entry');

    expect(await hashesOf(renamedClosure, 'App\\Items.run')).toEqual(
      await hashesOf(original, 'App\\Items.run'),
    );
    expect(await kindsOf(original, 'App\\Items.run')).toEqual(['BOUNDARY']);
  });

  it('keeps the fingerprint stable under formatting, comments and redundant parentheses', async () => {
    const compact = `<?php
namespace App;
class Pricer {
  public function price(int $amount): int {
    if ($amount > 5) { return 1; }
    $this->total = ($amount + 1);
    return 0;
  }
}`;
    const formatted = `<?php
namespace App;

class Pricer
{
    /* pricing rule */
    public function price( int $amount ): int
    {
        // threshold check
        if (($amount) > 5) {
            return 1;
        }
        $this->total = $amount + 1; # same write
        return 0;
    }
}`;

    expect(await hashesOf(formatted, 'App\\Pricer.price')).toEqual(
      await hashesOf(compact, 'App\\Pricer.price'),
    );
  });

  it('changes the fingerprint when a literal, an operator, a member or a string changes', async () => {
    const base = `<?php
namespace App;
class Pricer {
  public function price(int $amount): int {
    if ($amount > 5) { throw new \\RuntimeException('too big'); }
    $this->balance = $amount;
    return 0;
  }
}`;
    const baseHashes = await hashesOf(base, 'App\\Pricer.price');

    const changes = [
      base.replace('$amount > 5', '$amount > 6'),
      base.replace('$amount > 5', '$amount >= 5'),
      base.replace('$this->balance', '$this->saldo'),
      base.replace("'too big'", "'too large'"),
    ];
    for (const changed of changes) {
      const hashes = await hashesOf(changed, 'App\\Pricer.price');
      expect(hashes).not.toEqual(baseHashes);
    }
  });

  it('localizes methods in a namespace declared with a semicolon', async () => {
    const source = `<?php
namespace App\\Billing;
class Policy {
  public function run(): void { if ($this->x < 1) { return; } }
}`;

    expect(await kindsOf(source, 'App\\Billing\\Policy.run')).toEqual(['BOUNDARY']);
  });

  it('localizes methods in a namespace declared with a block, among several namespaces', async () => {
    const source = `<?php
namespace A {
  class Same { public function run(): void { if ($this->x > 1) { return; } } }
}
namespace B {
  class Same { public function run(): void { if ($this->y > 1) { return; } } }
}`;

    const constructs = await extractPhpBehaviorConstructs(source, 'B\\Same.run');

    expect(constructs.map((item) => item.snippet)).toEqual(['if ($this->y > 1)']);
  });

  it('localizes top-level functions with and without a namespace', async () => {
    const namespaced = `<?php
namespace App\\Util;
function clamp(int $value): int { if ($value > 10) { return 10; } return $value; }`;
    const global = `<?php
function clamp(int $value): int { if ($value > 10) { return 10; } return $value; }`;

    expect(await kindsOf(namespaced, 'App\\Util\\clamp')).toEqual(['BOUNDARY']);
    expect(await kindsOf(global, 'clamp')).toEqual(['BOUNDARY']);
  });

  it('returns an empty list for a missing symbol, a wrong namespace or unparseable PHP', async () => {
    const source = `<?php
namespace App\\Billing;
class Policy {
  public function run(): void { if ($this->x < 1) { return; } }
}`;

    expect(await extractPhpBehaviorConstructs(source, 'App\\Billing\\Missing.run')).toEqual([]);
    expect(await extractPhpBehaviorConstructs(source, 'App\\Billing\\Policy.missing')).toEqual([]);
    expect(await extractPhpBehaviorConstructs(source, 'Other\\Policy.run')).toEqual([]);
    expect(await extractPhpBehaviorConstructs('<?php class { function ( {', 'Policy.run')).toEqual([]);
  });

  it('builds formHash as the full SHA-256 of the form and keeps snippets on one line of at most 160 characters', async () => {
    const longCondition = Array.from({ length: 40 }, (_, index) => `$this->value${index} > ${index}`).join(
      ' &&\n      ',
    );
    const source = `<?php
namespace App;
class Long {
  public function run(): void {
    if (${longCondition}) { return; }
  }
}`;

    const constructs = await extractPhpBehaviorConstructs(source, 'App\\Long.run');

    expect(constructs).toHaveLength(1);
    const [construct] = constructs;
    expect(construct.formHash).toBe(createHash('sha256').update(construct.form, 'utf8').digest('hex'));
    expect(construct.snippet).not.toMatch(/\n/);
    expect(construct.snippet.length).toBeLessThanOrEqual(160);
    expect(construct.snippet.endsWith('...')).toBe(true);
  });

  it('is deterministic across repeated runs', async () => {
    const source = `<?php
namespace App;
class Stable {
  public function run(int $a): void { if ($a < 1) { $this->x = $a; } else { throw new \\LogicException('x'); } }
}`;

    const first = await extractPhpBehaviorConstructs(source, 'App\\Stable.run');
    const second = await extractPhpBehaviorConstructs(source, 'App\\Stable.run');

    expect(second).toEqual(first);
    expect(first.map((item) => item.scenarioKind)).toEqual(['BOUNDARY', 'STATE_TRANSITION', 'EXCEPTION']);
  });

  it('enters nested closures as the TypeScript extractor does', async () => {
    const source = `<?php
namespace App;
class Items {
  public function run(array $items): void {
    array_map(function ($item) { if ($item->x < 1) { return; } }, $items);
  }
}`;

    expect(await kindsOf(source, 'App\\Items.run')).toEqual(['BOUNDARY']);
  });

  it('keeps the pilot fixtures: PremiumDiscountPolicy, CancellationPolicy and Subscription', async () => {
    const premium = `<?php
namespace App\\Billing;
final class PremiumDiscountPolicy {
  public function __construct(private int $minimumSubtotalCents) {}
  public function discountFor(Customer $customer, int $subtotalCents): int {
    if (! $customer->isPremium()) {
      return 0;
    }
    if (round($subtotalCents / 100) < round($this->minimumSubtotalCents / 100)) {
      return 0;
    }
    return 10;
  }
}`;
    const cancellation = `<?php
namespace App\\Booking;
final class CancellationPolicy {
  private const LATE_CANCELLATION_WINDOW_HOURS = 24;
  public function refundFor(int $secondsBeforeStart): int {
    if ($secondsBeforeStart <= self::LATE_CANCELLATION_WINDOW_HOURS * 3600) {
      return 0;
    }
    return 100;
  }
}`;
    const subscription = `<?php
namespace App\\Subscriptions;
class Subscription {
  public function nextChargeAmount(): int {
    if ($this->status === self::STATUS_PAST_DUE && $this->pendingPlan !== null) {
      return $this->pendingPlan->monthly_price_cents;
    }
    return $this->plan->monthly_price_cents;
  }
}`;

    expect(await kindsOf(premium, 'App\\Billing\\PremiumDiscountPolicy.discountFor')).toEqual([
      'EXPECTED_RESULT',
      'BOUNDARY',
    ]);
    expect(await kindsOf(cancellation, 'App\\Booking\\CancellationPolicy.refundFor')).toEqual(['BOUNDARY']);
    expect(await kindsOf(subscription, 'App\\Subscriptions\\Subscription.nextChargeAmount')).toEqual([
      'EXPECTED_RESULT',
    ]);
  });
});
