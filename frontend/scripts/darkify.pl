#!/usr/bin/perl
# Structural + semantic light->dark class codemod for the v3 unified dark
# theme. Converts the Tailwind *light* scale (50/100 fills, 200/300 borders,
# 600-900 text) into dark-native tints. Leaves saturated 400/500/600 *fills*
# (gradients, buttons, meters) untouched. Gradient stops (from-/to-/via-) and
# bespoke panels are fixed by hand per page.
use strict;
use warnings;

local $/;
my $s = <>;

# ---- Neutral surfaces (slate + gray) -> dark panels/borders -------------
for my $n (qw(slate gray)) {
  $s =~ s{bg-$n-50/\d+}{bg-white/[0.03]}g;
  $s =~ s{bg-$n-50(?![\d/])}{bg-white/[0.03]}g;
  $s =~ s{bg-$n-100/\d+}{bg-white/[0.06]}g;
  $s =~ s{bg-$n-100(?!\d)}{bg-white/[0.06]}g;
  $s =~ s{bg-$n-200(?!\d)}{bg-white/10}g;
  $s =~ s{border-$n-200(?!\d)}{border-white/10}g;
  $s =~ s{border-$n-100(?!\d)}{border-white/[0.06]}g;
  $s =~ s{border-$n-300(?!\d)}{border-white/10}g;
  $s =~ s{ring-$n-200(?!\d)}{ring-white/10}g;
}

# Neutral text ramp
$s =~ s{text-slate-900(?!\d)}{text-white}g;
$s =~ s{text-slate-800(?!\d)}{text-slate-100}g;
$s =~ s{text-slate-700(?!\d)}{text-slate-200}g;
$s =~ s{text-slate-600(?!\d)}{text-slate-300}g;
$s =~ s{text-slate-500(?!\d)}{text-slate-400}g;
$s =~ s{text-gray-900(?!\d)}{text-white}g;
$s =~ s{text-gray-800(?!\d)}{text-slate-100}g;
$s =~ s{text-gray-700(?!\d)}{text-slate-200}g;
$s =~ s{text-gray-600(?!\d)}{text-slate-300}g;
$s =~ s{text-gray-500(?!\d)}{text-slate-400}g;

# Row hovers / striping
$s =~ s{hover:bg-blue-50/50}{hover:bg-white/[0.04]}g;
$s =~ s{hover:bg-blue-50(?![\d/])}{hover:bg-white/[0.04]}g;
$s =~ s{odd:bg-white(?![\w/.\-])}{odd:bg-transparent}g;

# Brand-dark text is too dark on the near-black canvas
$s =~ s{text-brand-dark}{text-brand}g;

# ---- Chromatic light scale -> dark tints --------------------------------
my @chroma = qw(red rose pink orange amber yellow emerald green teal cyan
                sky blue indigo violet purple fuchsia);
for my $c (@chroma) {
  # Fills (50/100) -> translucent tint
  $s =~ s{bg-$c-50/\d+}{bg-$c-500/10}g;
  $s =~ s{bg-$c-50(?![\d/])}{bg-$c-500/10}g;
  $s =~ s{bg-$c-100/\d+}{bg-$c-500/15}g;
  $s =~ s{bg-$c-100(?!\d)}{bg-$c-500/15}g;
  # Borders (200/300) -> translucent
  $s =~ s{border-$c-200(?!\d)}{border-$c-500/25}g;
  $s =~ s{border-$c-300(?!\d)}{border-$c-500/30}g;
  # Text (dark light-theme text -> bright dark-theme text)
  $s =~ s{text-$c-900(?!\d)}{text-$c-200}g;
  $s =~ s{text-$c-800(?!\d)}{text-$c-300}g;
  $s =~ s{text-$c-700(?!\d)}{text-$c-300}g;
  $s =~ s{text-$c-600(?!\d)}{text-$c-400}g;
}

# Bare white surfaces -> subtle dark panel (exclude bg-white/..., bg-white-...)
$s =~ s{bg-white(?![\w/.\-])}{bg-white/[0.03]}g;

print $s;
