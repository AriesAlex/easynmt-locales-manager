import fetch from 'node-fetch'
import fs from 'fs-extra'
import { URL } from 'url'
import structuredClone from 'structured-clone'

const __dirname = new URL('.', import.meta.url).pathname.slice(1)
const translationWays = fs.readJSONSync(__dirname + 'translation_ways.json')
let translationMap = null
function buildTranslationMap() {
  const map = {}
  for (const way of translationWays) {
    const [sourceLang, targetLang] = way.split('-')
    if (!map[sourceLang]) {
      map[sourceLang] = []
    }
    if (!map[targetLang]) {
      map[targetLang] = []
    }
    map[sourceLang].push(targetLang)
    map[targetLang].push(sourceLang)
  }
  translationMap = map
}
buildTranslationMap()

function isTranslationWayAvailable(sourceLang, targetLang) {
  return translationWays.includes(`${sourceLang}-${targetLang}`)
}

function getNextAvailableTargetLang(sourceLang, targetLang) {
  if (isTranslationWayAvailable(sourceLang, targetLang)) return null
  const visited = new Set([sourceLang])
  const queue = [[sourceLang, []]]
  while (queue.length > 0) {
    const [currentLang, path] = queue.shift()
    for (const nextLang of translationMap[currentLang]) {
      if (!visited.has(nextLang)) {
        const newPath = [...path, nextLang]
        if (isTranslationWayAvailable(nextLang, targetLang)) {
          return nextLang
        }
        visited.add(nextLang)
        queue.push([nextLang, newPath])
      }
    }
  }
  return null
}

const defaultOptions = {
  mainLocale: 'ru',
  localesFolder: 'locales',
  useTranslationWays: true,
}

class Translator {
  translations = null
  alreadyPrintedMainLocaleTexts = false

  constructor(options = defaultOptions) {
    const mergedOptions = { ...defaultOptions, ...options }
    for (const optionKey of Object.keys(options)) {
      this[optionKey] = mergedOptions[optionKey]
    }

    this.translations = this.readTranslations()
    this.translateLocales()
  }

  async translateLocales() {
    for (const locale of Object.keys(this.translations))
      await this.translateLocale(locale)

    this.writeTranslations()
  }

  async translateLocale(locale) {
    if (this.mainLocale == locale) return
    const needToTranslateObject = structuredClone(
      this.getObjectDifference(
        this.translations[this.mainLocale],
        this.translations[locale]
      )
    )

    const toTranslate = []
    this.applyToObjectFields(needToTranslateObject, prop =>
      toTranslate.push(prop)
    )

    const translated =
      toTranslate.length > 0
        ? await this.translate(toTranslate, this.mainLocale, locale)
        : []

    let i = 0
    this.applyToObjectFields(needToTranslateObject, (prop, obj, key) => {
      obj[key] = translated[i++]
    })

    this.translations[locale] = this.mergeObjects(
      this.translations[locale],
      needToTranslateObject
    )
    this.translations[locale] = this.objectWithRemovedExtraFields(
      this.translations[this.mainLocale],
      this.translations[locale]
    )
  }

  readTranslations() {
    const translations = {}
    fs.readdirSync(this.localesFolder).forEach(file => {
      let fileContent = fs
        .readFileSync(`${this.localesFolder}/${file}`)
        .toString()
      if (!fileContent) fileContent = '{}'
      translations[file.split('.json')[0]] = JSON.parse(fileContent)
    })
    return translations
  }

  writeTranslations() {
    Object.keys(this.translations).forEach(lang => {
      fs.writeJSONSync(
        `${this.localesFolder}/${lang}.json`,
        this.translations[lang],
        {
          spaces: 2,
        }
      )
    })
  }

  getObjectDifference(obj1, obj2) {
    const result = {}
    for (const key in obj1) {
      if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
        const diff = this.getObjectDifference(obj1[key], obj2[key])
        if (Object.keys(diff).length > 0) {
          result[key] = diff
        }
      } else if (!obj2.hasOwnProperty(key)) {
        result[key] = obj1[key]
      }
    }
    return result
  }

  mergeObjects(obj1, obj2) {
    const result = {}
    for (const key in obj1) {
      if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
        result[key] = this.mergeObjects(obj1[key], obj2[key])
      } else if (obj2.hasOwnProperty(key)) {
        result[key] = obj2[key]
      } else {
        result[key] = obj1[key]
      }
    }
    for (const key in obj2) {
      if (!obj1.hasOwnProperty(key)) {
        result[key] = obj2[key]
      }
    }
    return result
  }

  objectWithRemovedExtraFields(obj1, obj2) {
    const result = {}
    for (const key in obj2) {
      if (obj1.hasOwnProperty(key)) {
        if (typeof obj1[key] === 'object' && typeof obj2[key] === 'object') {
          result[key] = this.objectWithRemovedExtraFields(obj1[key], obj2[key])
        } else {
          result[key] = obj2[key]
        }
      }
    }
    return result
  }

  applyToObjectFields(obj, cb) {
    for (const key in obj) {
      const prop = obj[key]
      if (typeof prop != 'string') this.applyToObjectFields(prop, cb)
      else {
        cb(prop, obj, key)
      }
    }
  }

  async translate(
    texts,
    sourceLang = 'ru',
    targetLang = 'en',
    returnWithTargetLang = false
  ) {
    if (!Array.isArray(texts)) texts = [texts]
    if (sourceLang === targetLang) return texts

    if (
      this.useTranslationWays &&
      !isTranslationWayAvailable(sourceLang, targetLang)
    ) {
      const translated = await this.translate(
        texts,
        sourceLang,
        getNextAvailableTargetLang(sourceLang, targetLang),
        true
      )
      sourceLang = translated.targetLang
      texts = translated.texts
    }

    let url = 'http://localhost:24080/translate?'
    url += `source_lang=${sourceLang}&target_lang=${targetLang}`
    for (const text of texts) url += `&text=${encodeURIComponent(text)}`

    if (sourceLang == this.mainLocale && !this.alreadyPrintedMainLocaleTexts) {
      console.log(`Translating.. [${sourceLang}=>${targetLang}]`, texts)
      this.alreadyPrintedMainLocaleTexts = true
    } else {
      console.log(`\nTranslating.. [${sourceLang}=>${targetLang}]`)
    }

    const res = await fetch(url)
    const translated = (await res.json()).translated
    console.log(`Translated:  `, translated)
    return returnWithTargetLang ? { texts: translated, targetLang } : translated
  }
}

export default new Translator()
