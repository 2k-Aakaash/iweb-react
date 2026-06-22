// Browser-safe, lightweight implementation of Natural package NLP utilities

export class WordTokenizer {
  tokenize(text) {
    if (!text) return [];
    return text.toLowerCase().match(/\b\w+\b/g) || [];
  }
}

export class PorterStemmer {
  static stem(word) {
    // Simple stemmer fallback or lightweight porter stemmer rules
    let w = word.toLowerCase();
    if (w.length < 3) return w;
    if (w.endsWith('ing')) return w.slice(0, -3);
    if (w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us') && !w.endsWith('is')) return w.slice(0, -1);
    if (w.endsWith('ed')) return w.slice(0, -2);
    if (w.endsWith('ly')) return w.slice(0, -2);
    if (w.endsWith('ment')) return w.slice(0, -4);
    return w;
  }
}

export class LogisticRegressionClassifier {
  // Mock / simple helper if needed
}

export class BayesClassifier {
  constructor() {
    this.tokenizer = new WordTokenizer();
    this.docs = [];
    this.vocabulary = new Set();
    this.classFeatures = {}; // class -> {word -> count}
    this.classDocCounts = {}; // class -> docCount
    this.totalDocs = 0;
  }

  addDocument(text, className) {
    if (typeof text === 'string') {
      text = this.tokenizer.tokenize(text);
    }
    // Apply basic stemming
    const stemmed = text.map(w => PorterStemmer.stem(w));
    this.docs.push({ text: stemmed, className });
    
    if (!this.classDocCounts[className]) {
      this.classDocCounts[className] = 0;
    }
    this.classDocCounts[className]++;
    this.totalDocs++;

    if (!this.classFeatures[className]) {
      this.classFeatures[className] = {};
    }

    stemmed.forEach(word => {
      this.vocabulary.add(word);
      if (!this.classFeatures[className][word]) {
        this.classFeatures[className][word] = 0;
      }
      this.classFeatures[className][word]++;
    });
  }

  train() {
    // Naive Bayes training is lazy, computed at classification time or pre-cached.
  }

  classify(text) {
    const tokens = typeof text === 'string' ? this.tokenizer.tokenize(text) : text;
    const stemmed = tokens.map(w => PorterStemmer.stem(w));

    let bestClass = null;
    let maxScore = -Infinity;

    const classes = Object.keys(this.classDocCounts);
    if (classes.length === 0) return null;

    classes.forEach(className => {
      // Prior P(Class)
      let logProb = Math.log(this.classDocCounts[className] / this.totalDocs);
      
      // Total words in class (with Laplace smoothing)
      const classWordCounts = Object.values(this.classFeatures[className]);
      const totalWordsInClass = classWordCounts.reduce((a, b) => a + b, 0);
      const vocabSize = this.vocabulary.size;

      stemmed.forEach(word => {
        const wordCountInClass = this.classFeatures[className][word] || 0;
        // P(Word | Class) with Laplace smoothing
        const condProb = (wordCountInClass + 1) / (totalWordsInClass + vocabSize);
        logProb += Math.log(condProb);
      });

      if (logProb > maxScore) {
        maxScore = logProb;
        bestClass = className;
      }
    });

    return bestClass;
  }
}

// Default export mimicking npm structure
const natural = {
  WordTokenizer,
  BayesClassifier,
  PorterStemmer
};

export default natural;
