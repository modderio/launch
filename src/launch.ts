import fs from 'fs'
import path from 'path'
import nodemon from 'nodemon'
import glob from 'glob'

import { emitKeypressEvents } from 'readline'

export interface LauchOptions {
  name?: string
  package?: string
  script: string
  inspect?: string
  watch?: string[]
  ignore?: string[]
  cwd?: string[]
  exec?: string
  args?: {
    node?: string[]
    script?: string[]
  }
  env?: {
    $file: string
    [key: string]: string
  }
}

export interface Package {
  name: string
  workspaces?: string[]
  packages?: string[]
  launch: LauchOptions[]
}

export class Lauch {
  paths = {
    root: process.cwd(),
    cwd: process.cwd(),
    package: '',
  }

  id?: string
  package?: Package
  options?: LauchOptions

  constructor() {
    emitKeypressEvents(process.stdin)

    process.on('SIGINT', () => {
      process.exit(0)
    })
    process.stdin.setRawMode(true)
    process.stdin.on('keypress', (str, key) => {
      if (key && key.ctrl && key.name === 'c') {
        process.kill(0, 'SIGINT')
      }

      if (key && key.ctrl && key.name === 'r') {
        nodemon.restart()
      }
    })
  }

  async start(id: string) {
    this.id = id

    if (!fs.existsSync(path.resolve(this.paths.root, 'package.json'))) {
      throw new Error('No package.json found in current working directory')
    }

    const pkg = JSON.parse(fs.readFileSync(path.resolve(this.paths.root, 'package.json')).toString()) as Package
    if (!pkg.launch || !Array.isArray(pkg.launch)) {
      throw new Error('package.json does not contain a valid launch object')
    }

    for (const opts of pkg.launch) {
      if (this.id === opts.name || this.id === opts.package) {
        this.options = opts
      }
    }

    if (!this.options) {
      throw new Error(`package.json does not contain a launch object with the id of '${this.id}'`)
    }

    this.package = pkg

    if (this.options.package && (!this.package.packages || !this.package.workspaces)) {
      throw new Error(`package.json does not contain a 'packages' or 'workspaces' array`)
    }

    if (this.options.package) {
      let globs: string[] = []
      if (this.package.workspaces) {
        globs = globs.concat(this.package.workspaces)
      }
      if (this.package.packages) {
        globs = globs.concat(this.package.packages)
      }
      const find = await this.find(globs)
      if (typeof find !== 'string') {
        throw new Error(`unable to find package.json for package ${this.id}`)
      }
      this.paths.package = find
    }

    this.paths.cwd = this.replace(this.paths.cwd)

    const script = this.replace(this.options.script)
    let env: { [key: string]: string } = {}

    if (this.options.env) {
      if (this.options.env.$file) {
        try {
          const dotenv = require('dotenv').parse(fs.readFileSync(this.replace(this.options.env.$file)))
          env = { ...env, ...dotenv }
        } catch (err) {}
        delete this.options.env.$file
      }

      for (const k of Object.keys(this.options.env)) {
        env[k] = this.replace(this.options.env[k])
      }
    }

    const watch = []
    if (this.options.watch) {
      for (const w of this.options.watch) {
        watch.push(this.replace(w))
      }
    }

    const ignore = []
    if (this.options.ignore) {
      for (const i of this.options.ignore) {
        ignore.push(this.replace(i))
      }
    }

    let exec = 'node'
    const nodeArgs = []
    if (this.options.inspect) {
      nodeArgs.unshift(`--inspect=${this.options.inspect}`)
    }

    if (this.options.exec) {
      exec = this.options.exec
    }

    const args = []
    if (this.options.args) {
      if (this.options.args.node) {
        for (const a of this.options.args.node) {
          nodeArgs.push(this.replace(a))
        }
      }
      if (this.options.args.script) {
        for (const a of this.options.args.script) {
          args.push(this.replace(a))
        }
      }
    }

    const options = {
      cwd: this.paths.cwd,
      script,
      watch,
      env,
      ignore,
      args,
      exec: exec === 'node' ? `${exec} ${nodeArgs.join(' ')}` : exec,
      colours: true,
    }

    nodemon(options)
      .on('stderr', stderr => console.log(stderr))
      .on('exit', () => console.log(`${this.id} closed`))
      .on('log', log => console.log(log.colour))
  }

  find(globs: string[]): Promise<string | undefined> {
    return Promise.all(
      globs.map(
        glb =>
          new Promise((resolve, reject) => {
            glob(`${glb}/**/package.json`, { cwd: this.paths.cwd }, (err, matches) => {
              if (err) reject(err)
              for (const m of matches) {
                if (JSON.parse(fs.readFileSync(m).toString()).name === this.options?.package) {
                  resolve(m.replace('package.json', ''))
                  break
                }
              }
              resolve(null)
            })
          }),
      ),
    ).then(results => {
      for (const r of results) {
        if (typeof r === 'string') {
          return r
        }
      }
      return undefined
    })
  }

  replace(str: string) {
    return str
      .replace(/\$\{cwd\}/i, this.paths.cwd)
      .replace(/\$\{root\}/i, this.paths.root)
      .replace(/\$\{package\}/i, this.paths.package)
      .replace(/\/\//m, '/')
      .replace(/\\\\/m, '\\')
  }
}
