#!/usr/bin/perl
# Structural light->dark class mapping for the v3 unified dark theme.
# Only touches unambiguous structural classes (slate text/surfaces, white
# striping, slate borders, brand-dark). Semantic colored panels (red-50,
# amber-50, blue-50, sky-50, emerald-50) and charts are fixed by hand per page.
use strict;
use warnings;

local $/;
my $s = <>;

# Surfaces / striping (most specific first)
$s =~ s{bg-slate-50/95}{bg-white/[0.03]}g;
$s =~ s{bg-slate-50/70}{bg-white/[0.03]}g;
$s =~ s{bg-slate-50/60}{bg-white/[0.03]}g;
$s =~ s{bg-slate-50/50}{bg-white/[0.02]}g;
$s =~ s{bg-slate-50(?![\d/])}{bg-white/[0.03]}g;
$s =~ s{bg-slate-100(?!\d)}{bg-white/[0.06]}g;
$s =~ s{bg-slate-200(?!\d)}{bg-white/10}g;

# Borders
$s =~ s{border-slate-200(?!\d)}{border-white/10}g;
$s =~ s{border-slate-100(?!\d)}{border-white/[0.06]}g;
$s =~ s{border-slate-300(?!\d)}{border-white/10}g;

# Row hovers / striping
$s =~ s{hover:bg-blue-50/50}{hover:bg-white/[0.04]}g;
$s =~ s{hover:bg-blue-50(?![\d/])}{hover:bg-white/[0.04]}g;
$s =~ s{odd:bg-white(?![\w/.\-])}{odd:bg-transparent}g;

# Text ramp
$s =~ s{text-slate-900(?!\d)}{text-white}g;
$s =~ s{text-slate-800(?!\d)}{text-slate-100}g;
$s =~ s{text-slate-700(?!\d)}{text-slate-200}g;
$s =~ s{text-slate-600(?!\d)}{text-slate-300}g;
$s =~ s{text-slate-500(?!\d)}{text-slate-400}g;

# Brand-dark text is too dark on the near-black canvas
$s =~ s{text-brand-dark}{text-brand}g;

# Bare white surfaces -> subtle dark panel (exclude bg-white/..., bg-white-...)
$s =~ s{bg-white(?![\w/.\-])}{bg-white/[0.03]}g;

print $s;
