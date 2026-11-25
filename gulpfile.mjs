import gulp from "gulp";
import ts from "gulp-typescript";
import sourcemaps from "gulp-sourcemaps";
import * as dartSass from 'sass';
import gulpSass from 'gulp-sass';
import fs from "fs-extra";

const tsProject = ts.createProject("tsconfig.json");
const sass = gulpSass(dartSass);

const staticFiles = [
	'assets',
	'lang',
	'module.json',
	'templates',
	'README.md',
	'LICENSE'
];

export function scripts() {
    return gulp.src('module/**/*.ts')
		.pipe(sourcemaps.init())
		.pipe(tsProject())
		// Maps beside the scripts, not inlined: an inlined map tripled every script a client loads.
		.pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('dist/module'));
}

// A Sass error must fail `build` (a release would otherwise ship without its stylesheet), while
// `watch` only logs it and keeps watching. sass.logError ends the stream normally, so it is used
// for watch alone.
function compileStyles({ keepGoing }) {
	const compile = sass({
		outputStyle: "compressed",
		silenceDeprecations: ['legacy-js-api', 'import'],
	});
	return gulp.src([`scss/**/*.scss`], { base: `scss` })
		.pipe(sourcemaps.init({ loadMaps: true }))
		.pipe(keepGoing ? compile.on("error", sass.logError) : compile)
		.pipe(sourcemaps.write("."))
		.pipe(gulp.dest(`dist/styles`));
}

export function styles() {
	return compileStyles({ keepGoing: false });
}

function stylesWatch() {
	return compileStyles({ keepGoing: true });
}

async function copyFiles() {
	for (const file of staticFiles) {
		if (fs.existsSync(file)) {
			await fs.copy(file, `dist/${file}`);
		}
	}
}

export function watch() {
    gulp.watch('module/**/*.ts', scripts);
    gulp.watch('scss/**/*.scss', stylesWatch);
	gulp.watch(
		staticFiles,
		{ ignoreInitial: false },
		copyFiles,
	);
}

export const build = gulp.series(scripts, styles, copyFiles);
