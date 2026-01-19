pipeline {
    agent any

    environment {
        IMAGE_NAME = "qlhd-server:latest"
        CONTAINER_NAME = "qlhd-server"
        APP_PORT = "3000"

        // ĐƯỜNG DẪN FILE .env TRÊN HOST UBUNTU
        ENV_FILE = "/home/luna/Desktop/.env"
    }

    stages {

        stage('Checkout source') {
            steps {
                checkout scm
            }
        }

        stage('Build Docker image (server)') {
            steps {
                dir('server') {
                    sh '''
                    echo "=== Build Docker image ==="
                    docker build -t ${IMAGE_NAME} .
                    '''
                }
            }
        }

        stage('Stop old container') {
            steps {
                sh '''
                echo "=== Stop old container if exists ==="
                docker rm -f ${CONTAINER_NAME} || true
                '''
            }
        }

        stage('Run new container') {
            steps {
                sh '''
                echo "=== Run new container ==="
                docker run -d \
                  --name ${CONTAINER_NAME} \
                  --env-file ${ENV_FILE} \
                  -p ${APP_PORT}:${APP_PORT} \
                  --restart always \
                  ${IMAGE_NAME}
                '''
            }
        }
    }

    post {
        success {
            echo "✅ DEPLOY SUCCESS: qlhd-server is running on port ${APP_PORT}"
        }
        failure {
            echo "❌ DEPLOY FAILED"
        }
    }
}
