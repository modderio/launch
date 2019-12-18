import { Lauch } from '../launch'

new Lauch().start(process.argv[process.argv.length - 1]).catch(err => console.error(err))
