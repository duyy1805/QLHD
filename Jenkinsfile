pipeline {
    agent any

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Build server Docker') {
            steps {
                dir('server') {
                    sh '''
                    docker build -t qlhd-server .
                    '''
                }
            }
        }

        stage('Run server') {
            steps {
                sh '''
                docker rm -f qlhd-server || true
                docker run -d -p 3000:3000 --name qlhd-server qlhd-server
                '''
            }
        }
    }
}
